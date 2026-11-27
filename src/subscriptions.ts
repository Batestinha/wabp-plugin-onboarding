import { memberSubscriptionService, registerMemberSubscription, type MemberSubscription } from '@wabs/plugin-sdk/member-subscriptions';
import { configFor, database, type OnboardingDeps } from './onboarding';
import { eligibleMembers } from './updateEditions';
import { subscribed, setSubscription } from './updateDelivery';

const ns = 'official.onboarding';
export const updatesOffer: MemberSubscription = {
  id: 'updates', kind: 'internal', scope: 'community', labelKey: ns + '.subscription.title', serviceId: ns + '.subscriptions.v1',
  choices: ['off', 'on'].map(id => ({ id, labelKey: ns + '.subscription.' + id }))
};
export const updatesService = memberSubscriptionService(updatesOffer);

export async function updatesPreference(deps: OnboardingDeps, scope: string, identity: string, choice?: string) {
  const db = database(deps);
  if (!db || !(await configFor(deps, scope)).enabled || !(await eligibleMembers(deps, scope)).has(identity)) return null;
  if (choice !== undefined) setSubscription(db, scope, identity, choice === 'on');
  return { choice: subscribed(db, scope, identity) ? 'on' : 'off' };
}
export function updatesRegistration(deps: OnboardingDeps) {
  return registerMemberSubscription(updatesOffer, call => updatesPreference(deps, call.scopeId, call.actorIdentityId!),
    (call, choice) => updatesPreference(deps, call.scopeId, call.actorIdentityId!, choice));
}
