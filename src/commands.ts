import { withMessageSlot } from './messageSlot';
import type { CommandMetadata, CommandTargetSpec } from '@wabs/plugin-sdk/command-metadata';
import type { CommandContext, CommandResult } from '@wabs/plugin-sdk/commands';
import type { ManagedGroupCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import { ONBOARDING_MANAGE_PERMISSION, ONBOARDING_NAMESPACE as ns, ONBOARDING_PLUGIN_ID } from './constants';
import { catchUpCandidates, estimatedHours, prepareCatchUp } from './catchUp';
import { configFor, database, ensureSeeded, onboardingActions, personById, personByWid, type OnboardingDeps } from './onboarding';
import { catchUpRow, queuedCount, setCatchUpStatus, statusCounts } from './store';

import { updatesPreference } from './subscriptions';
import { requestUpdates, wakeUpdates } from './updateDelivery';

type Deps = OnboardingDeps;

const CHAT_FLAG_TARGET: CommandTargetSpec = { kind: 'group', name: 'chat', flag: 'chat' };
const SCOPE_TARGET: CommandTargetSpec = { kind: 'scope', flag: ['scope', 'scope-id'], fallback: 'current_scope' };

function metadata(subcommand: string, topicId: string, input: { permission?: string; mutation: CommandMetadata['mutation']; usage: string; dangerous?: boolean }): CommandMetadata {
  return {
    plane: 'group_operation',
    interaction: 'either_same_chat',
    pluginId: ONBOARDING_PLUGIN_ID,
    requiresManagedGroup: true,
    ...(input.permission ? { permission: input.permission } : { requiresCurrentManagedGroupMembership: true, currentManagedGroupMembershipMode: 'effective_scope' as const }),
    privateManagedTarget: { mode: 'infer_group_or_community', explicitTargetName: 'chat', collapseCommunities: true },
    targets: [CHAT_FLAG_TARGET, SCOPE_TARGET],
    mutation: input.mutation,
    ...(input.dangerous ? { dangerous: true } : {}),
    auditAction: `onboarding.${subcommand}`,
    help: {
      familyKey: `${ns}.help.family`,
      featureId: 'onboarding',
      topicId,
      descriptionKey: `${ns}.help.cmd.${subcommand}`,
      usage: input.usage,
      exampleKeys: [topicId === 'scope-updates' ? ns + '.help.updates.example' : topicId === 'group-rules' ? `${ns}.help.rules.example` : `${ns}.help.manage.example`]
    }
  };
}

function reply(
  text: string,
  pluginActions: NonNullable<CommandResult['pluginActions']> | ReturnType<typeof withMessageSlot> = [],
  slot?: ReturnType<typeof withMessageSlot>
): CommandResult {
  const actions = Array.isArray(pluginActions) ? pluginActions : [];
  const attached = Array.isArray(pluginActions) ? slot : pluginActions;
  return {
    handled: true,
    text,
    ...(actions.length ? { pluginActions: actions } : {}),
    ...(attached ?? {})
  };
}

function scopeOf(ctx: CommandContext): string | undefined {
  return ctx.targets?.scope?.id ?? ctx.scopeId;
}

export function registerOnboardingCommands(context: ManagedGroupCommandContext): void {
  const deps = context as unknown as Deps;
  const router = context.router;

  router.register('updates', '*', metadata('updates', 'scope-updates', { mutation: 'durable', usage: '/updates [on|off]' }), async ctx => {
    const selected = scopeOf(ctx);
    const scopeId = selected && (await deps.memberScopeFor?.(selected))?.id || selected;
    const actor = ctx.actor?.identityAddress;
    const db = database(deps);
    if (!scopeId || !actor || !db || !(await configFor(deps, scopeId)).enabled) return reply(ctx.t(ns + '.disabled'));
    const respond = (text: string): CommandResult => ({ handled: true, response: { kind: 'text', chatId: actor.deliveryChatId, disablePrivateDeliveryFallback: true, text } });
    const args = ctx.remainingArgs ?? ctx.command.rawArgs.trim().split(/\s+/u).filter(Boolean);
    const verb = args[0]?.toLowerCase();
    if (args.length > 1 || (verb && verb !== 'on' && verb !== 'off')) return respond(ctx.t(ns + '.editions.invitation'));
    const state = await updatesPreference(deps, scopeId, actor.identityId, verb);
    if (!state) return respond(ctx.t(ns + '.editions.ineligible'));
    const count = verb ? 0 : await requestUpdates(deps, db, scopeId, actor.identityId);
    if (count) await wakeUpdates(deps, scopeId);
    const preference = ctx.t(ns + (state.choice === 'on' ? '.editions.on' : '.editions.off'));
    return respond(verb ? preference : [ctx.t(ns + (count ? '.editions.queued' : '.editions.current'), { count }), preference].join('\n\n'));
  });

  router.register('onboarding', 'status', metadata('status', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'none', usage: '/onboarding status' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    const db = database(deps);
    if (!db) return reply(ctx.t(`${ns}.unavailable`), withMessageSlot(`${ns}.unavailable`));
    const counts = statusCounts(db, scopeId);
    return reply(ctx.t(`${ns}.status`, { state: ctx.t(`${ns}.state.${config.enabled ? 'on' : 'off'}`), ...counts }), withMessageSlot(`${ns}.status`));
  });

  router.register('onboarding', 'preview', metadata('preview', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'none', usage: '/onboarding preview' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    const actorId = ctx.actor?.identityAddress.identityId;
    if (!scopeId || !actorId) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const person = await personById(deps, actorId);
    if (!person) return reply(ctx.t(`${ns}.resend.unknown`), withMessageSlot(`${ns}.resend.unknown`));
    const config = await configFor(deps, scopeId);
    const actions = await onboardingActions(deps, { config, scopeId, person, groupId: ctx.groupId, groupWid: ctx.groupWid });
    return reply(ctx.t(`${ns}.preview.sent`), actions, withMessageSlot(`${ns}.preview.sent`));
  });

  router.register('onboarding', 'catch-up', metadata('catch-up', 'manage-onboarding', {
    permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'durable', usage: '/onboarding catch-up [start <count> | stop]', dangerous: true
  }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    const actorId = ctx.actor?.identityAddress.identityId;
    if (!scopeId || !actorId) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    if (!config.enabled) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const db = database(deps);
    if (!db) return reply(ctx.t(`${ns}.unavailable`), withMessageSlot(`${ns}.unavailable`));
    await ensureSeeded(deps, db, scopeId);
    const [verb, rawCount] = (ctx.remainingArgs ?? ctx.command.args).map((arg) => arg.toLowerCase());
    const campaign = catchUpRow(db, scopeId);
    const pace = { batch: config.catchUp.batchSize, minutes: config.catchUp.intervalMinutes, from: config.catchUp.sendFrom, until: config.catchUp.sendUntil };

    if (verb === 'stop') {
      if (campaign?.status !== 'running') return reply(ctx.t(`${ns}.catchUp.notRunning`), withMessageSlot(`${ns}.catchUp.notRunning`));
      setCatchUpStatus(db, scopeId, 'stopped', new Date());
      return reply(ctx.t(`${ns}.catchUp.stopped`, { sent: campaign.sent, left: queuedCount(db, scopeId) }),
        [{ type: 'audit.record', action: 'onboarding.catch-up.stopped', targetJson: { scopeId }, metadataJson: { reason: 'admin' } }], withMessageSlot(`${ns}.catchUp.stopped`));
    }
    if (campaign?.status === 'running') {
      return reply(ctx.t(`${ns}.catchUp.progress`, { sent: campaign.sent, skipped: campaign.skipped, left: queuedCount(db, scopeId) }), withMessageSlot(`${ns}.catchUp.progress`));
    }
    const candidates = await catchUpCandidates(deps, db, scopeId);
    if (candidates.length === 0) return reply(ctx.t(`${ns}.catchUp.none`), withMessageSlot(`${ns}.catchUp.none`));
    if (verb !== 'start') {
      return reply(ctx.t(`${ns}.catchUp.preview`, { count: candidates.length, hours: estimatedHours(config, candidates.length).toFixed(1), ...pace }), withMessageSlot(`${ns}.catchUp.preview`));
    }
    // The count must match what the admin saw, so a surprise change in membership never starts a bigger send.
    if (Number(rawCount) !== candidates.length) return reply(ctx.t(`${ns}.catchUp.countChanged`, { count: candidates.length }), withMessageSlot(`${ns}.catchUp.countChanged`));
    const started = await prepareCatchUp(deps, { db, config, scopeId, actorIdentityId: actorId, identityIds: candidates });
    return reply(ctx.t(`${ns}.catchUp.started`, { count: started.prepared, hours: estimatedHours(config, started.prepared).toFixed(1), ...pace }), started.actions, withMessageSlot(`${ns}.catchUp.started`));
  });

  router.register('onboarding', 'resend', metadata('resend', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'durable', usage: '/onboarding resend @member' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    if (!config.enabled) return reply(ctx.t(`${ns}.disabled`), withMessageSlot(`${ns}.disabled`));
    const wid = ctx.command.mentions[0] ?? ctx.message.mentions?.[0]?.wid ?? ctx.message.replyTo?.snapshot?.authorWid;
    if (!wid) return reply(ctx.t(`${ns}.resend.usage`), withMessageSlot(`${ns}.resend.usage`));
    const person = await personByWid(deps, wid);
    if (!person) return reply(ctx.t(`${ns}.resend.unknown`), withMessageSlot(`${ns}.resend.unknown`));
    const actions = await onboardingActions(deps, { config, scopeId, person, groupId: ctx.groupId, groupWid: ctx.groupWid });
    return reply(ctx.t(`${ns}.resend.done`, { member: person.name }), [
      { type: 'audit.record', action: 'onboarding.resent', targetJson: { scopeId, identityId: person.identityId } }, ...actions
    ], withMessageSlot(`${ns}.resend.done`));
  });
}
