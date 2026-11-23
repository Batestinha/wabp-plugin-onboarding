import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginDatabase } from '@wabs/plugin-sdk/database';
import type { PluginJobInput } from '@wabs/plugin-sdk/jobs';
import { withinSendingHours } from './catchUp';
import { ONBOARDING_NAMESPACE as ns, ONBOARDING_PLUGIN_ID } from './constants';
import { configFor, database, nowFrom, personById, scopeName, translatorForPerson, type OnboardingDeps } from './onboarding';
import { eligibleMembers } from './updateEditions';

export const UPDATE_JOB = 'updates.batch';
type Delivery = { edition: number; identity_id: string; requested: number; attempt: number; status: string; checked_at: number; body: string };
const deliveries = 'SELECT d.*, e.body FROM update_deliveries d JOIN update_editions e USING(scope_id, edition) ';
const deliveryKey = (row: Delivery) => 'edition/' + row.edition + '/' + row.identity_id + '/' + row.attempt;
const welcomeKey = (id: string) => 'edition-welcome/' + id;
const hasWork = (db: PluginDatabase, scopeId: string) => Boolean(db.get(
  "SELECT 1 AS pending FROM update_deliveries WHERE scope_id = ? AND status IN ('ready','waiting') LIMIT 1", scopeId));

function nextJob(scopeId: string, time: number) {
  // Round wakeups into the same minute so restarts and simultaneous publications share a job.
  const runAt = new Date(Math.ceil(time / 60_000) * 60_000);
  return { scopeId, jobName: UPDATE_JOB, executionClass: 'maintenance', runAt, payload: { scopeId },
    dedupeKey: UPDATE_JOB + ':' + scopeId + ':' + runAt.getTime(), replaceRetainedTerminalJob: true } satisfies PluginJobInput;
}

export async function wakeUpdates(deps: OnboardingDeps, scopeId: string) {
  const db = database(deps);
  if (db && hasWork(db, scopeId)) {
    if (!deps.enqueuePluginJob) throw new Error('Update scheduling is unavailable.');
    await deps.enqueuePluginJob(nextJob(scopeId, nowFrom(deps).getTime() + 1000));
  }
}

export function markWelcomeCoverage(db: PluginDatabase, scopeId: string, identityId: string, first: PluginAction | undefined, sendingScope = scopeId, coveredEdition?: number) {
  if (first?.type !== 'message.sendText') return;
  const latest = coveredEdition ?? db.get<{edition: number}>('SELECT MAX(edition) AS edition FROM update_editions WHERE scope_id = ?', scopeId)?.edition;
  if (!latest) return;
  db.run(`INSERT INTO update_members(scope_id, identity_id, welcome_pending, welcome_receipt_scope) VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_id, identity_id) DO UPDATE SET welcome_pending = excluded.welcome_pending, welcome_receipt_scope = excluded.welcome_receipt_scope`, scopeId, identityId, latest, sendingScope);
  first.idempotencyKey = welcomeKey(identityId);
}

async function welcomeFloor(deps: OnboardingDeps, db: PluginDatabase, scopeId: string, identityId: string) {
  const row = db.get<{welcome_pending: number; welcome_floor: number; welcome_receipt_scope: string}>(
    'SELECT welcome_pending, welcome_floor, welcome_receipt_scope FROM update_members WHERE scope_id = ? AND identity_id = ?', scopeId, identityId);
  if (!row?.welcome_pending) return row?.welcome_floor ?? 0;
  if (await deps.privateTextReceipt?.(row.welcome_receipt_scope || scopeId, welcomeKey(identityId)) === 'SENT') {
    db.run('UPDATE update_members SET welcome_floor = welcome_pending, welcome_pending = 0 WHERE scope_id = ? AND identity_id = ?', scopeId, identityId);
    return row.welcome_pending;
  }
  return row.welcome_floor;
}

export function subscribed(db: PluginDatabase, scopeId: string, id: string) {
  return db.get<{subscribed: number}>('SELECT subscribed FROM update_members WHERE scope_id = ? AND identity_id = ?', scopeId, id)?.subscribed === 1;
}
export function setSubscription(db: PluginDatabase, scopeId: string, id: string, on: boolean) {
  db.run(`INSERT INTO update_members(scope_id, identity_id, subscribed) VALUES (?, ?, ?)
    ON CONFLICT(scope_id, identity_id) DO UPDATE SET subscribed = excluded.subscribed`, scopeId, id, Number(on));
}

function status(db: PluginDatabase, scopeId: string, row: Delivery, value: string, now: number) {
  db.run(`UPDATE update_deliveries SET status = ?, checked_at = ?
    WHERE scope_id = ? AND edition = ? AND identity_id = ? AND attempt = ? AND status IN ('ready','waiting')`,
  value, now, scopeId, row.edition, row.identity_id, row.attempt);
}

export async function allowedUpdate(deps: OnboardingDeps, scopeId: string, input: { identityId: string; edition: number; attempt: number; recipient: string }) {
  const db = database(deps);
  if (!db || !(await configFor(deps, scopeId)).enabled) return false;
  const row = db.get<Delivery>(deliveries + 'WHERE scope_id = ? AND edition = ? AND identity_id = ? AND attempt = ?',
    scopeId, input.edition, input.identityId, input.attempt);
  if (!row || !['waiting', 'ready'].includes(row.status) || !(await eligibleMembers(deps, scopeId)).has(input.identityId)) return false;
  if (!deps.resolveIdentityAddress) throw new Error('Recipient identity resolution is unavailable.');
  if ((await deps.resolveIdentityAddress(input.recipient)).identityId !== input.identityId) return false;
  return Boolean(row.requested) || subscribed(db, scopeId, input.identityId);
}

async function reconcile(deps: OnboardingDeps, db: PluginDatabase, scopeId: string, row: Delivery, now: number) {
  if (!deps.privateTextReceipt) throw new Error('Private delivery receipts are unavailable.');
  const receipt = await deps.privateTextReceipt(scopeId, deliveryKey(row));
  if (receipt === 'MISSING' && now - row.checked_at < 60_000) return;
  const next = receipt === 'SENT' ? 'sent' : receipt === 'FAILED' ? 'stopped' : receipt === 'MISSING' ? 'ready' : 'waiting';
  status(db, scopeId, row, next, now);
}

/** A pull can retry a terminal failure, and never duplicates an in-flight automatic edition. */
export async function requestUpdates(deps: OnboardingDeps, db: PluginDatabase, scopeId: string, identityId: string) {
  const floor = await welcomeFloor(deps, db, scopeId, identityId);
  const now = nowFrom(deps).getTime();
  for (const row of db.all<Delivery>(deliveries + "WHERE scope_id = ? AND identity_id = ? AND status = 'waiting'", scopeId, identityId)) {
    await reconcile(deps, db, scopeId, row, now);
  }
  db.run(`INSERT INTO update_deliveries(scope_id, edition, identity_id, requested)
    SELECT scope_id, edition, ?, 1 FROM update_editions WHERE scope_id = ? AND edition > ?
    ON CONFLICT(scope_id, edition, identity_id) DO UPDATE SET requested = 1,
      attempt = attempt + CASE WHEN status = 'stopped' THEN 1 ELSE 0 END,
      status = CASE WHEN status = 'stopped' THEN 'ready' ELSE status END WHERE status <> 'sent'`,
  identityId, scopeId, floor);
  return Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM update_deliveries WHERE scope_id = ? AND identity_id = ? AND edition > ? AND status IN ('ready','waiting')",
    scopeId, identityId, floor)?.n ?? 0);
}

export async function runUpdateBatch(deps: OnboardingDeps, scopeId: string): Promise<PluginAction[]> {
  const db = database(deps);
  if (!db || !hasWork(db, scopeId)) return [];
  const config = await configFor(deps, scopeId);
  if (!config.enabled) return [];
  const now = nowFrom(deps).getTime();
  const pace = config.catchUp;
  const interval = pace.intervalMinutes * 60_000;
  const schedule = (after: number): PluginAction => ({ ...nextJob(scopeId, after), type: 'plugin.enqueueJob', pluginId: ONBOARDING_PLUGIN_ID, scopeId });
  for (const row of db.all<Delivery>(deliveries + "WHERE scope_id = ? AND status = 'waiting' ORDER BY checked_at, edition, identity_id LIMIT ?", scopeId, pace.batchSize * 2)) {
    await reconcile(deps, db, scopeId, row, now);
  }
  if (!hasWork(db, scopeId)) return [];
  const next = db.get<{next_batch_at: number}>('SELECT next_batch_at FROM update_drafts WHERE scope_id = ?', scopeId)?.next_batch_at ?? 0;
  if (next > now) return [schedule(next)];
  const zone = (await deps.clockFor?.(scopeId))?.timezone ?? 'UTC';
  const inHours = withinSendingHours(new Date(now), pace.sendFrom, pace.sendUntil, zone);
  const rows = db.all<Delivery>(deliveries + `WHERE scope_id = ? AND status = 'ready' AND (requested = 1 OR ? = 1)
    ORDER BY requested DESC, edition, identity_id LIMIT ?`, scopeId, Number(inHours), pace.batchSize);
  if (!rows.length) return [schedule(now + (inHours ? interval : Math.min(interval, 30 * 60_000)))];
  const members = await eligibleMembers(deps, scopeId);
  const name = await scopeName(deps, scopeId);
  const actions: PluginAction[] = [];
  if (!db.run('UPDATE update_drafts SET next_batch_at = ? WHERE scope_id = ? AND next_batch_at <= ?', now + interval, scopeId, now).changes) return [schedule(now + interval)];
  for (const row of rows) {
    const id = row.identity_id;
    if (!members.has(id) || (!row.requested && !subscribed(db, scopeId, id))) {
      status(db, scopeId, row, 'stopped', now);
      continue;
    }
    if (row.edition <= await welcomeFloor(deps, db, scopeId, id)) {
      status(db, scopeId, row, 'stopped', now);
      continue;
    }
    const person = await personById(deps, id);
    if (!person) {
      status(db, scopeId, row, 'stopped', now);
      continue;
    }
    const t = await translatorForPerson(deps, id, scopeId);
    status(db, scopeId, row, 'waiting', now);
    actions.push({ type: 'message.sendText', chatId: person.deliveryChatId, text: t(ns + '.editions.message', { scope: name, edition: row.edition, body: row.body }),
      idempotencyKey: deliveryKey(row), deliveryCheck: { identityId: id, edition: row.edition, attempt: row.attempt } });
  }
  if (hasWork(db, scopeId)) actions.push(schedule(now + interval));
  return actions;
}
