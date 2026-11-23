import { onboardingConfigPaths } from './config';
import { ONBOARDING_PLUGIN_ID } from './constants';

export interface OnboardingControl {
  id: string; path: string; label: string; description: string; section: string; order: number;
  schema: Record<string, unknown>; ui: Record<string, unknown>;
}

let order = 0;
function control(section: string, path: string, label: string, description: string, schema: Record<string, unknown>, widget: string): OnboardingControl {
  order += 10;
  return { id: `plugin.${ONBOARDING_PLUGIN_ID}.${path}`, path, label, description, section, order, schema, ui: { widget, helpText: description } };
}
const toggle = (s: string, p: string, l: string, d: string) => control(s, p, l, d, { type: 'boolean' }, 'toggle');
const text = (s: string, p: string, l: string, d: string, max: number) =>
  ({ ...control(s, p, l, d, { type: 'string', max }, 'text'), ui: { widget: 'text', multiline: true, helpText: d } });
const number = (s: string, p: string, l: string, d: string, min: number, max: number, unit?: string) =>
  control(s, p, l, d, { type: 'number', min, max, ...(unit ? { unit } : {}) }, 'number');
const tags = (s: string, p: string, l: string, d: string) => control(s, p, l, d, { type: 'array', items: { type: 'string' } }, 'tags');

const GENERAL = 'Onboarding & Updates';
const MESSAGES = 'Messages';

export const onboardingControls: OnboardingControl[] = [
  { ...toggle(GENERAL, 'enabled', 'Enabled', 'Welcome newcomers and manage update editions in this scope.'),
    ui: { widget: 'builder', builderId: 'official.onboarding.editions.v1', builderEndpoints: {
      state: '/api/v1/plugins/official.onboarding/:scopeId/editions', edit: '/api/v1/plugins/official.onboarding/:scopeId/editions' } } },
  tags(GENERAL, 'exemptGroupChatIds', 'Exempt groups', 'Groups whose arrivals never count as arriving here.'),
  text(MESSAGES, 'welcome.text', 'Welcome', 'Private welcome. Empty uses the built-in text. Use {name} and {scope}.', 2000),
  text(MESSAGES, 'rules.text', 'Rules', 'Shown in the welcome and with /rules. Empty: no rules.', 4000),
  toggle(MESSAGES, 'guide.enabled', 'Getting-started guide', 'Send a short guide built from /help: what members can do here.'),
  number(MESSAGES, 'guide.maxEntries', 'Guide entries', 'Most commands listed in the guide.', 1, 50),
  tags(MESSAGES, 'guide.includeFamilies', 'Guide: only these', 'Help families to keep in the guide; empty keeps every family.'),
  tags(MESSAGES, 'guide.excludeFamilies', 'Guide: leave out', 'Help families to leave out of the guide.'),
  toggle(MESSAGES, 'invitation.enabled', 'Account invitation', 'Also send the invitation text below.'),
  text(MESSAGES, 'invitation.text', 'Invitation text', 'For example how and where to create an account. Use {name} and {scope}.', 2000),
  toggle(MESSAGES, 'invitation.skipLinked', 'Skip if already linked', 'Do not send the invitation to people who already have a linked account.'),
  text(MESSAGES, 'catchUp.intro', 'Late welcome opening', 'Opening of the one-time late welcome for people who were already here. Empty uses the built-in text. Use {name} and {scope}.', 2000),
  number(GENERAL, 'catchUp.batchSize', 'Late welcomes per batch', 'People who get the late welcome in each batch.', 1, 20),
  number(GENERAL, 'catchUp.intervalMinutes', 'Minutes between batches', 'Pause between late-welcome batches, so the bot never sends a burst.', 1, 240, 'minutes'),
  control(GENERAL, 'catchUp.sendFrom', 'Late welcomes from', 'Earliest local time (HH:MM) for late welcomes.', { type: 'string', max: 5 }, 'text'),
  control(GENERAL, 'catchUp.sendUntil', 'Late welcomes until', 'Latest local time (HH:MM) for late welcomes.', { type: 'string', max: 5 }, 'text'),
  toggle(MESSAGES, 'welcomeBack.enabled', 'Welcome back', 'Send a short welcome back to people who left every group here and return.'),
  text(MESSAGES, 'welcomeBack.text', 'Welcome back text', 'Empty uses the built-in text. Use {name} and {scope}.', 1000),
  number(MESSAGES, 'welcomeBack.minAbsenceDays', 'Away at least', 'Days away before a return gets the welcome back.', 0, 3650, 'days')
];

export { onboardingConfigPaths };
