import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginParticipantChangeEvent, PluginRuntimeHooks } from '@wabs/plugin-sdk/hooks';
import { runCatchUpBatch } from './catchUp';
import { CATCH_UP_JOB } from './constants';
import {
  configFor,
  database,
  decideArrival,
  ensureSeeded,
  mirrorGroupWids,
  onboardingActions,
  recordDeparture,
  welcomeBackActions,
  type OnboardingDeps
} from './onboarding';

const ARRIVALS = new Set<PluginParticipantChangeEvent['action']>(['join', 'add', 'membership_approved']);
const DEPARTURES = new Set<PluginParticipantChangeEvent['action']>(['leave', 'remove']);

export function createOnboardingHooks(context: OnboardingDeps): PluginRuntimeHooks {
  return {
    async onRuntimeReady(event) {
      if (!event.firstReadyForIdentity) return;
      const db = database(context);
      if (!db) return;
      for (const scope of await context.listEnabledScopes?.() ?? []) {
        const config = await configFor(context, scope.scopeId);
        if (config.enabled) await ensureSeeded(context, db, scope.scopeId).catch(() => undefined);
      }
    },
    async onParticipantChange(event) {
      return handleParticipantChange(context, event);
    },
    async onPluginJob(job) {
      if (job.jobName !== CATCH_UP_JOB) return;
      const scopeId = (job.payload as { scopeId?: unknown } | undefined)?.scopeId;
      return runCatchUpBatch(context, typeof scopeId === 'string' ? scopeId : job.scopeId);
    }
  };
}

export async function handleParticipantChange(context: OnboardingDeps, event: PluginParticipantChangeEvent): Promise<PluginAction[] | void> {
  if (!event.groupWid) return;
  const arrival = ARRIVALS.has(event.action);
  if (!arrival && !DEPARTURES.has(event.action)) return;
  const config = await configFor(context, event.scopeId);
  if (!config.enabled || config.exemptGroupChatIds.includes(event.groupWid)) return;
  // Community and announcement groups mirror subgroup membership; the subgroup event decides.
  if ((await mirrorGroupWids(context, event.scopeId)).has(event.groupWid)) return;
  const db = database(context);
  if (!db) return;
  const bots = new Set(event.botIdentityIds);
  const people = event.affectedIdentities.filter((identity) => !bots.has(identity.identityId));
  if (people.length === 0) return;
  // Seed before the first decision; the people arriving right now are decided normally.
  await ensureSeeded(context, db, event.scopeId, arrival ? people.map((person) => person.identityId) : []);
  const byBot = Boolean(event.actorIdentity && bots.has(event.actorIdentity.identityId));

  if (!arrival) {
    for (const person of people) {
      const selfLeave = event.action === 'leave' && (!event.actorIdentity || event.actorIdentity.identityId === person.identityId);
      await recordDeparture(context, { db, config, scopeId: event.scopeId, groupWid: event.groupWid, identityId: person.identityId, voluntary: selfLeave && !byBot });
    }
    return;
  }

  const actions: PluginAction[] = [];
  for (const identity of people) {
    const decision = await decideArrival(context, { db, config, scopeId: event.scopeId, groupWid: event.groupWid, identityId: identity.identityId, byBot });
    if (decision.outcome === 'onboarded' && decision.person) {
      actions.push({ type: 'audit.record', action: 'onboarding.welcomed', targetJson: { scopeId: event.scopeId, identityId: identity.identityId, groupWid: event.groupWid } });
      actions.push(...await onboardingActions(context, {
        config, scopeId: event.scopeId, person: decision.person,
        groupId: event.groupId, groupWid: event.groupWid, fallbackGroupWid: event.groupWid
      }));
    } else if (decision.outcome === 'welcome-back' && decision.person) {
      actions.push({ type: 'audit.record', action: 'onboarding.welcomed-back', targetJson: { scopeId: event.scopeId, identityId: identity.identityId, groupWid: event.groupWid } });
      actions.push(...await welcomeBackActions(context, config, event.scopeId, decision.person));
    }
  }
  return actions;
}
