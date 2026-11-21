import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginDatabase } from '@wabs/plugin-sdk/database';
import type { OnboardingConfig } from './config';
import { CATCH_UP_JOB, ONBOARDING_NAMESPACE as ns, ONBOARDING_PLUGIN_ID } from './constants';
import { configFor, database, nowFrom, onboardingActions, personById, translatorForPerson, type OnboardingDeps } from './onboarding';
import {
  catchUpRow,
  countCatchUp,
  markCatchUpSkipped,
  markLateOnboarded,
  markQueuedSent,
  nextQueued,
  pendingLate,
  queuedCount,
  setCatchUpStatus,
  startCatchUp
} from './store';

const OUTSIDE_HOURS_RETRY_MS = 30 * 60_000;

/** Hours from the first to the last batch at the configured pace (sending hours only). */
export function estimatedHours(config: OnboardingConfig, people: number): number {
  const batches = Math.ceil(people / config.catchUp.batchSize);
  return Math.max(0, batches - 1) * config.catchUp.intervalMinutes / 60;
}

export function catchUpJob(scopeId: string, runAt: Date): PluginAction {
  return {
    type: 'plugin.enqueueJob',
    pluginId: ONBOARDING_PLUGIN_ID,
    jobName: CATCH_UP_JOB,
    executionClass: 'maintenance',
    scopeId,
    runAt,
    payload: { scopeId },
    dedupeKey: `${CATCH_UP_JOB}:${scopeId}:${runAt.toISOString()}`
  };
}

function minutesIn(at: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
}

function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function withinSendingHours(at: Date, from: string, until: string, timeZone: string): boolean {
  const now = minutesIn(at, timeZone);
  const start = toMinutes(from);
  const end = toMinutes(until);
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Everyone who would get the late welcome now: still in the scope and not suspended or expelled. */
export async function catchUpCandidates(deps: OnboardingDeps, db: PluginDatabase, scopeId: string): Promise<string[]> {
  const current = new Set(await deps.currentMemberIdentityIdsForScope?.(scopeId) ?? []);
  const held = new Set((await deps.memberStandingsForScope?.(scopeId).catch(() => []) ?? []).map((standing) => standing.identityId));
  return pendingLate(db, scopeId).map((row) => row.identity_id).filter((identityId) => current.has(identityId) && !held.has(identityId));
}

/**
 * Starts the one-time catch-up. Runs where the /help guide is available (a command), so every person's
 * messages are prepared here and stored; the paced job only delivers them.
 */
export async function prepareCatchUp(deps: OnboardingDeps, input: {
  db: PluginDatabase; config: OnboardingConfig; scopeId: string; actorIdentityId: string; identityIds: string[];
}): Promise<{ prepared: number; actions: PluginAction[] }> {
  const queue: Array<{ identityId: string; deliveryChatId: string; addresses: string[]; messages: string[] }> = [];
  for (const identityId of input.identityIds) {
    const person = await personById(deps, identityId);
    if (!person) continue;
    const actions = await onboardingActions(deps, { config: input.config, scopeId: input.scopeId, person, intro: input.config.catchUp.intro });
    const messages = actions.flatMap((action) => (action.type === 'message.sendText' ? [action.text] : []));
    if (messages.length) queue.push({ identityId, deliveryChatId: person.deliveryChatId, addresses: [...person.addresses], messages });
  }
  const groups = (await deps.coveredGroupsForScope?.(input.scopeId).catch(() => []) ?? [])
    .map((group) => group.groupWid).filter((groupWid) => !input.config.exemptGroupChatIds.includes(groupWid));
  const now = nowFrom(deps);
  startCatchUp(input.db, { scopeId: input.scopeId, actorIdentityId: input.actorIdentityId, now, groups, queue });
  return {
    prepared: queue.length,
    actions: [
      { type: 'audit.record', action: 'onboarding.catch-up.started', targetJson: { scopeId: input.scopeId }, metadataJson: { prepared: queue.length } },
      catchUpJob(input.scopeId, now)
    ]
  };
}

/**
 * One paced batch of prepared late welcomes. Each person is re-checked at send time (still in one of the
 * scope's groups, no suspension or expulsion) and marked as welcomed before the messages go out.
 */
export async function runCatchUpBatch(deps: OnboardingDeps, scopeId: string): Promise<PluginAction[]> {
  const db = database(deps);
  if (!db) return [];
  const campaign = catchUpRow(db, scopeId);
  if (!campaign || campaign.status !== 'running') return [];
  const config = await configFor(deps, scopeId);
  const now = nowFrom(deps);
  if (!config.enabled) {
    setCatchUpStatus(db, scopeId, 'stopped', now);
    return [{ type: 'audit.record', action: 'onboarding.catch-up.stopped', targetJson: { scopeId }, metadataJson: { reason: 'disabled' } }];
  }
  const timeZone = (await deps.clockFor?.(scopeId).catch(() => undefined))?.timezone ?? 'UTC';
  if (!withinSendingHours(now, config.catchUp.sendFrom, config.catchUp.sendUntil, timeZone)) {
    return [catchUpJob(scopeId, new Date(now.getTime() + OUTSIDE_HOURS_RETRY_MS))];
  }

  const groups = JSON.parse(campaign.groups_json) as string[];
  const present = new Set<string>();
  for (const groupWid of groups) {
    for (const participant of await deps.getGroupParticipants?.(groupWid).catch(() => []) ?? []) present.add(participant.wid);
  }
  const held = new Set((await deps.memberStandingsForScope?.(scopeId).catch(() => []) ?? []).map((standing) => standing.identityId));
  const actions: PluginAction[] = [];
  let sent = 0;
  let skipped = 0;
  while (sent < config.catchUp.batchSize) {
    const rows = nextQueued(db, scopeId, config.catchUp.batchSize - sent);
    if (rows.length === 0) break;
    for (const row of rows) {
      const addresses = JSON.parse(row.addresses_json) as string[];
      const stillHere = addresses.some((address) => present.has(address));
      if (!stillHere || held.has(row.identity_id) || !markLateOnboarded(db, scopeId, row.identity_id, now)) {
        markCatchUpSkipped(db, scopeId, row.identity_id, now);
        skipped += 1;
        continue;
      }
      markQueuedSent(db, scopeId, row.identity_id, now);
      for (const text of JSON.parse(row.messages_json) as string[]) actions.push({ type: 'message.sendText', chatId: row.delivery_chat_id, text });
      sent += 1;
    }
  }
  countCatchUp(db, scopeId, sent, skipped);
  actions.unshift({ type: 'audit.record', action: 'onboarding.catch-up.batch', targetJson: { scopeId }, metadataJson: { sent, skipped } });

  if (queuedCount(db, scopeId) > 0) {
    actions.push(catchUpJob(scopeId, new Date(now.getTime() + config.catchUp.intervalMinutes * 60_000)));
    return actions;
  }
  setCatchUpStatus(db, scopeId, 'finished', now);
  const finished = catchUpRow(db, scopeId)!;
  const starter = await personById(deps, finished.started_by_identity_id);
  if (starter) {
    const t = await translatorForPerson(deps, starter.identityId, scopeId);
    actions.push({ type: 'message.sendText', chatId: starter.deliveryChatId, text: t(`${ns}.catchUp.finished`, { sent: finished.sent, skipped: finished.skipped }) });
  }
  return actions;
}
