import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginDatabase, PluginDatabaseRegistry } from '@wabs/plugin-sdk/database';
import type { PluginCoveredGroup } from '@wabs/plugin-sdk/hook-plugin';
import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { StableIdentityAddressResolution } from '@wabs/plugin-sdk/identity';
import type { PluginNewcomerGuideFor } from '@wabs/plugin-sdk/newcomer-guide';
import type { GroupParticipant } from '@wabs/plugin-sdk/transport';
import { parseOnboardingConfig, type OnboardingConfig } from './config';
import { DAY_MS, ONBOARDING_DATABASE, ONBOARDING_NAMESPACE as ns } from './constants';
import { clearLeft, insertMember, isSeeded, markLeft, memberRow, seedScope } from './store';

/** Host capabilities used here; hooks and commands each provide them. */
export interface OnboardingDeps {
  memberScopeFor?: import('@wabs/plugin-sdk/hook-plugin').PluginMemberScopeFor | undefined;
  enqueuePluginJob?: import('@wabs/plugin-sdk/jobs').PluginJobContext['enqueuePluginJob'];
  privateTextReceipt?: import('@wabs/plugin-sdk/managed-group-plugin').ManagedGroupCapabilities['privateTextReceipt'];
  configFor?: ((scopeId: string, actorIdentityId?: string | undefined) => Promise<Record<string, unknown>>) | undefined;
  databases?: PluginDatabaseRegistry | undefined;
  coveredGroupsForScope?: ((scopeId: string) => Promise<PluginCoveredGroup[]>) | undefined;
  communityGroupWidForScope?: ((scopeId: string) => Promise<string | undefined>) | undefined;
  communityAnnouncementGroupWidForScope?: ((scopeId: string) => Promise<string | undefined>) | undefined;
  currentMemberIdentityIdsForScope?: ((scopeId: string) => Promise<string[]>) | undefined;
  getGroupParticipants?: ((groupWid: string) => Promise<GroupParticipant[]>) | undefined;
  resolveIdentityAddress?: ((wid: string) => Promise<StableIdentityAddressResolution>) | undefined;
  resolveStableIdentityById?: ((identityId: string) => Promise<StableIdentityAddressResolution>) | undefined;
  listEnabledScopes?: (() => Promise<Array<{ scopeId: string; name?: string | undefined }>>) | undefined;
  newcomerGuideFor?: PluginNewcomerGuideFor | undefined;
  memberStandingsForScope?: ((scopeId: string) => Promise<Array<{ identityId: string; standing: string }>>) | undefined;
  clockFor?: ((scopeId: string) => Promise<{ timezone: string }>) | undefined;
  identityAccess?: { hasLinkedAccount?(identityId: string): Promise<boolean> } | undefined;
  i18n?: {
    translatorForScope?(scopeId: string): Promise<TranslateFn>;
    translatorForIdentity?(identityId: string, scopeId?: string): Promise<TranslateFn>;
  } | undefined;
  now?: (() => Date) | undefined;
}

export interface Person {
  identityId: string;
  deliveryChatId: string;
  mentionWid: string;
  name: string;
  addresses: Set<string>;
}

export function nowFrom(deps: OnboardingDeps): Date {
  return deps.now?.() ?? new Date();
}

export async function configFor(deps: OnboardingDeps, scopeId: string): Promise<OnboardingConfig> {
  return parseOnboardingConfig(deps.configFor ? await deps.configFor(scopeId) : {});
}

export function database(deps: OnboardingDeps): PluginDatabase | undefined {
  return deps.databases?.open(ONBOARDING_DATABASE);
}

export function toPerson(resolution: StableIdentityAddressResolution): Person {
  return {
    identityId: resolution.identityId,
    deliveryChatId: resolution.deliveryChatId,
    mentionWid: resolution.mentionWid,
    name: resolution.displayName?.trim() || `@${resolution.mentionWid.split('@')[0]}`,
    addresses: new Set([resolution.canonicalWid, resolution.originalWid, resolution.mentionWid, resolution.deliveryChatId,
      ...resolution.phoneWids, ...resolution.lidWids, ...resolution.aliases].filter(Boolean))
  };
}

export async function personById(deps: OnboardingDeps, identityId: string): Promise<Person | undefined> {
  try {
    return deps.resolveStableIdentityById ? toPerson(await deps.resolveStableIdentityById(identityId)) : undefined;
  } catch {
    return undefined;
  }
}

export async function personByWid(deps: OnboardingDeps, wid: string): Promise<Person | undefined> {
  try {
    return deps.resolveIdentityAddress ? toPerson(await deps.resolveIdentityAddress(wid)) : undefined;
  } catch {
    return undefined;
  }
}

export async function translatorForPerson(deps: OnboardingDeps, identityId: string, scopeId: string): Promise<TranslateFn> {
  return translatorFor(deps, identityId, scopeId);
}

export async function scopeName(deps: OnboardingDeps, scopeId: string): Promise<string> {
  const owner = await deps.memberScopeFor?.(scopeId);
  if (owner?.id === scopeId && owner.name.trim()) return owner.name;
  const scopes = await deps.listEnabledScopes?.().catch(() => []) ?? [];
  return scopes.find((scope) => scope.scopeId === scopeId)?.name?.trim() || scopeId;
}

async function translatorFor(deps: OnboardingDeps, identityId: string, scopeId: string): Promise<TranslateFn> {
  return await deps.i18n?.translatorForIdentity?.(identityId, scopeId).catch(() => undefined)
    ?? await deps.i18n?.translatorForScope?.(scopeId).catch(() => undefined)
    ?? ((key: string) => key);
}

/** Records every current member once per scope, so enabling the plugin never welcomes them. */
export async function ensureSeeded(deps: OnboardingDeps, db: PluginDatabase, scopeId: string, exceptIdentityIds: readonly string[] = []): Promise<void> {
  if (isSeeded(db, scopeId) || !deps.currentMemberIdentityIdsForScope) return;
  const except = new Set(exceptIdentityIds);
  const members = (await deps.currentMemberIdentityIdsForScope(scopeId)).filter((identityId) => !except.has(identityId));
  seedScope(db, scopeId, members, nowFrom(deps));
}

/** Whether the person is in any covered group of the scope other than `exceptGroupWid`. */
/**
 * The community's own group and its announcement group. WhatsApp puts everyone who joins any subgroup into
 * both, at the same moment, so membership there says nothing about having been here before.
 */
export async function mirrorGroupWids(deps: OnboardingDeps, scopeId: string): Promise<Set<string>> {
  const wids = await Promise.all([
    deps.communityGroupWidForScope?.(scopeId).catch(() => undefined),
    deps.communityAnnouncementGroupWidForScope?.(scopeId).catch(() => undefined)
  ]);
  return new Set(wids.filter((wid): wid is string => Boolean(wid)));
}

export async function inOtherScopeGroup(deps: OnboardingDeps, scopeId: string, person: Person, exceptGroupWid: string, config: OnboardingConfig): Promise<boolean> {
  const mirrors = await mirrorGroupWids(deps, scopeId);
  const groups = (await deps.coveredGroupsForScope?.(scopeId).catch(() => []) ?? [])
    .filter((group) => group.groupWid !== exceptGroupWid && !config.exemptGroupChatIds.includes(group.groupWid) && !mirrors.has(group.groupWid));
  for (const group of groups) {
    const participants = await deps.getGroupParticipants?.(group.groupWid).catch(() => []) ?? [];
    if (participants.some((participant) => person.addresses.has(participant.wid))) return true;
  }
  return false;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(name|scope)\}/gu, (_, key: string) => values[key] ?? `{${key}}`);
}

/** The private onboarding: welcome and rules, the member guide from /help, and the optional invitation. */
export async function onboardingActions(deps: OnboardingDeps, input: {
  config: OnboardingConfig;
  scopeId: string;
  person: Person;
  groupId?: string | undefined;
  groupWid?: string | undefined;
  /** When set, a failed private delivery posts the first message in this group with a mention. */
  fallbackGroupWid?: string | undefined;
  /** Replaces the welcome line, for the late welcome of people who were already here. */
  intro?: string | undefined;
}): Promise<PluginAction[]> {
  const { config, scopeId, person } = input;
  const t = await translatorFor(deps, person.identityId, scopeId);
  const values = { name: person.name, scope: await scopeName(deps, scopeId) };
  const welcome = input.intro !== undefined
    ? fill(input.intro.trim() || t(`${ns}.catchUp.introDefault`, values), values)
    : fill(config.welcome.text.trim() || t(`${ns}.welcome.default`, values), values);
  const rules = config.rules.text.trim();
  let guide: string[] = [];
  if (config.guide.enabled && deps.newcomerGuideFor) {
    guide = await deps.newcomerGuideFor({
      scopeId,
      identityId: person.identityId,
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.groupWid ? { groupWid: input.groupWid } : {}),
      maxEntries: config.guide.maxEntries,
      includeFamilies: config.guide.includeFamilies,
      excludeFamilies: config.guide.excludeFamilies
    }).catch(() => []);
  }
  const first = [welcome, t(ns + '.editions.invitation'), ...(rules ? [`${t(`${ns}.rules.header`)}\n${rules}`] : []), ...(guide.length ? [] : [t(`${ns}.guide.footer`)])].join('\n\n');
  const actions: PluginAction[] = [{
    type: 'message.sendText',
    chatId: person.deliveryChatId,
    text: first,
    ...(input.fallbackGroupWid ? { privateDeliveryFallback: { chatId: input.fallbackGroupWid, mentionedWids: [person.mentionWid] } } : {})
  }];
  if (guide.length) {
    actions.push({ type: 'message.sendText', chatId: person.deliveryChatId, text: [t(`${ns}.guide.intro`), ...guide, t(`${ns}.guide.footer`)].join('\n\n') });
  }
  const invitation = config.invitation.text.trim();
  if (config.invitation.enabled && invitation) {
    const linked = config.invitation.skipLinked
      ? await deps.identityAccess?.hasLinkedAccount?.(person.identityId).catch(() => false) ?? false
      : false;
    if (!linked) actions.push({ type: 'message.sendText', chatId: person.deliveryChatId, text: fill(invitation, values) });
  }
  return actions;
}

export async function welcomeBackActions(deps: OnboardingDeps, config: OnboardingConfig, scopeId: string, person: Person): Promise<PluginAction[]> {
  const t = await translatorFor(deps, person.identityId, scopeId);
  const values = { name: person.name, scope: await scopeName(deps, scopeId) };
  return [{ type: 'message.sendText', chatId: person.deliveryChatId,
    text: [fill(config.welcomeBack.text.trim() || t(`${ns}.welcomeBack.default`, values), values), t(ns + '.editions.invitation')].join('\n\n') }];
}

export type ArrivalOutcome = 'onboarded' | 'existing' | 'known' | 'welcome-back' | 'skipped';

/**
 * Decides one arrival. Onboarding happens only on a person's first arrival in the scope: never again in
 * another group of the same scope, never for people already in the scope, and never for re-adds by the bot (they already have a row).
 */
export async function decideArrival(deps: OnboardingDeps, input: {
  db: PluginDatabase;
  config: OnboardingConfig;
  scopeId: string;
  groupWid: string;
  identityId: string;
  byBot: boolean;
}): Promise<{ outcome: ArrivalOutcome; person?: Person | undefined }> {
  const { db, config, scopeId, identityId } = input;
  const now = nowFrom(deps);
  const row = memberRow(db, scopeId, identityId);
  if (row) {
    if (!row.left_scope_at) return { outcome: 'known' };
    const away = now.getTime() - Date.parse(row.left_scope_at);
    clearLeft(db, scopeId, identityId);
    // Not byBot: the bot approving a returning member's join request is their own return. Suspension re-adds
    // stay silent because a removal is never a voluntary departure.
    if (!row.left_voluntarily || !config.welcomeBack.enabled || away < config.welcomeBack.minAbsenceDays * DAY_MS) {
      return { outcome: 'known' };
    }
    return { outcome: 'welcome-back', person: await personById(deps, identityId) };
  }
  // Who let them in doesn't matter for a first arrival: with join approval on and only the bot as admin,
  // every newcomer arrives through the bot's approval, and whatsmeow reports approvals, invite joins and
  // direct adds alike as 'join' by the acting admin. Bot re-adds of known people stay silent above (they
  // have a row), and people added along with existing members are caught by the other-group check below.
  const person = await personById(deps, identityId);
  if (!person) return { outcome: 'skipped' };
  if (await inOtherScopeGroup(deps, scopeId, person, input.groupWid, config)) {
    insertMember(db, scopeId, identityId, 'existing', now);
    return { outcome: 'existing', person };
  }
  // Recording before sending makes duplicate events for the same arrival harmless.
  return { outcome: insertMember(db, scopeId, identityId, 'onboarded', now) ? 'onboarded' : 'known', person };
}

/** After a departure, remembers when the person left the scope entirely (and whether they chose to). */
export async function recordDeparture(deps: OnboardingDeps, input: {
  db: PluginDatabase; config: OnboardingConfig; scopeId: string; groupWid: string; identityId: string; voluntary: boolean;
}): Promise<void> {
  if (!memberRow(input.db, input.scopeId, input.identityId)) return;
  const person = await personById(deps, input.identityId);
  if (!person || await inOtherScopeGroup(deps, input.scopeId, person, input.groupWid, input.config)) return;
  markLeft(input.db, input.scopeId, input.identityId, input.voluntary, nowFrom(deps));
}
