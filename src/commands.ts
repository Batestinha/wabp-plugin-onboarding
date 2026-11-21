import type { CommandMetadata, CommandTargetSpec } from '@wabs/plugin-sdk/command-metadata';
import type { CommandContext, CommandResult } from '@wabs/plugin-sdk/commands';
import type { ManagedGroupCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import { ONBOARDING_MANAGE_PERMISSION, ONBOARDING_NAMESPACE as ns, ONBOARDING_PLUGIN_ID } from './constants';
import { catchUpCandidates, estimatedHours, prepareCatchUp } from './catchUp';
import { configFor, database, ensureSeeded, onboardingActions, personById, personByWid, type OnboardingDeps } from './onboarding';
import { catchUpRow, queuedCount, setCatchUpStatus, statusCounts } from './store';

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
      exampleKeys: [topicId === 'group-rules' ? `${ns}.help.rules.example` : `${ns}.help.manage.example`]
    }
  };
}

function reply(text: string, pluginActions: CommandResult['pluginActions'] = []): CommandResult {
  return { handled: true, text, ...(pluginActions && pluginActions.length ? { pluginActions } : {}) };
}

function scopeOf(ctx: CommandContext): string | undefined {
  return ctx.targets?.scope?.id ?? ctx.scopeId;
}

export function registerOnboardingCommands(context: ManagedGroupCommandContext): void {
  const deps = context as unknown as Deps;
  const router = context.router;

  router.register('rules', '*', metadata('rules', 'group-rules', { mutation: 'none', usage: '/rules' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId) return reply(ctx.t(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    if (!config.enabled) return reply(ctx.t(`${ns}.disabled`));
    const rules = config.rules.text.trim();
    return reply(rules ? `${ctx.t(`${ns}.rules.header`)}\n${rules}` : ctx.t(`${ns}.rules.none`));
  });

  router.register('onboarding', 'status', metadata('status', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'none', usage: '/onboarding status' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId) return reply(ctx.t(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    const db = database(deps);
    if (!db) return reply(ctx.t(`${ns}.unavailable`));
    const counts = statusCounts(db, scopeId);
    return reply(ctx.t(`${ns}.status`, { state: ctx.t(`${ns}.state.${config.enabled ? 'on' : 'off'}`), ...counts }));
  });

  router.register('onboarding', 'preview', metadata('preview', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'none', usage: '/onboarding preview' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    const actorId = ctx.actor?.identityAddress.identityId;
    if (!scopeId || !actorId) return reply(ctx.t(`${ns}.disabled`));
    const person = await personById(deps, actorId);
    if (!person) return reply(ctx.t(`${ns}.resend.unknown`));
    const config = await configFor(deps, scopeId);
    const actions = await onboardingActions(deps, { config, scopeId, person, groupId: ctx.groupId, groupWid: ctx.groupWid });
    return reply(ctx.t(`${ns}.preview.sent`), actions);
  });

  router.register('onboarding', 'catch-up', metadata('catch-up', 'manage-onboarding', {
    permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'durable', usage: '/onboarding catch-up [start <count> | stop]', dangerous: true
  }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    const actorId = ctx.actor?.identityAddress.identityId;
    if (!scopeId || !actorId) return reply(ctx.t(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    if (!config.enabled) return reply(ctx.t(`${ns}.disabled`));
    const db = database(deps);
    if (!db) return reply(ctx.t(`${ns}.unavailable`));
    await ensureSeeded(deps, db, scopeId);
    const [verb, rawCount] = (ctx.remainingArgs ?? ctx.command.args).map((arg) => arg.toLowerCase());
    const campaign = catchUpRow(db, scopeId);
    const pace = { batch: config.catchUp.batchSize, minutes: config.catchUp.intervalMinutes, from: config.catchUp.sendFrom, until: config.catchUp.sendUntil };

    if (verb === 'stop') {
      if (campaign?.status !== 'running') return reply(ctx.t(`${ns}.catchUp.notRunning`));
      setCatchUpStatus(db, scopeId, 'stopped', new Date());
      return reply(ctx.t(`${ns}.catchUp.stopped`, { sent: campaign.sent, left: queuedCount(db, scopeId) }),
        [{ type: 'audit.record', action: 'onboarding.catch-up.stopped', targetJson: { scopeId }, metadataJson: { reason: 'admin' } }]);
    }
    if (campaign?.status === 'running') {
      return reply(ctx.t(`${ns}.catchUp.progress`, { sent: campaign.sent, skipped: campaign.skipped, left: queuedCount(db, scopeId) }));
    }
    const candidates = await catchUpCandidates(deps, db, scopeId);
    if (candidates.length === 0) return reply(ctx.t(`${ns}.catchUp.none`));
    if (verb !== 'start') {
      return reply(ctx.t(`${ns}.catchUp.preview`, { count: candidates.length, hours: estimatedHours(config, candidates.length).toFixed(1), ...pace }));
    }
    // The count must match what the admin saw, so a surprise change in membership never starts a bigger send.
    if (Number(rawCount) !== candidates.length) return reply(ctx.t(`${ns}.catchUp.countChanged`, { count: candidates.length }));
    const started = await prepareCatchUp(deps, { db, config, scopeId, actorIdentityId: actorId, identityIds: candidates });
    return reply(ctx.t(`${ns}.catchUp.started`, { count: started.prepared, hours: estimatedHours(config, started.prepared).toFixed(1), ...pace }), started.actions);
  });

  router.register('onboarding', 'resend', metadata('resend', 'manage-onboarding', { permission: ONBOARDING_MANAGE_PERMISSION, mutation: 'durable', usage: '/onboarding resend @member' }), async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId) return reply(ctx.t(`${ns}.disabled`));
    const config = await configFor(deps, scopeId);
    if (!config.enabled) return reply(ctx.t(`${ns}.disabled`));
    const wid = ctx.command.mentions[0] ?? ctx.message.mentions?.[0]?.wid ?? ctx.message.replyTo?.snapshot?.authorWid;
    if (!wid) return reply(ctx.t(`${ns}.resend.usage`));
    const person = await personByWid(deps, wid);
    if (!person) return reply(ctx.t(`${ns}.resend.unknown`));
    const actions = await onboardingActions(deps, { config, scopeId, person, groupId: ctx.groupId, groupWid: ctx.groupWid });
    return reply(ctx.t(`${ns}.resend.done`, { member: person.name }), [
      { type: 'audit.record', action: 'onboarding.resent', targetJson: { scopeId, identityId: person.identityId } }, ...actions
    ]);
  });
}
