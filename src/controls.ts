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
const memberVariables = [
  { token: 'name', label: 'Member name', sampleValue: 'Ana' },
  { token: 'scope', label: 'Community or group name', sampleValue: 'Walking Club' }
];

function message(section: string, path: string, label: string, helpText: string, max: number, personalized = false) {
  return {
    ...control(section, path, label, helpText, { type: 'string', max }, 'text'),
    ui: { widget: 'text', label, multiline: true, helpText, templateDialect: 'token-substitution-v1',
      ...(personalized ? { templateVariables: memberVariables } : {}) }
  };
}
const number = (s: string, p: string, l: string, d: string, min: number, max: number, unit?: string) =>
  control(s, p, l, d, { type: 'number', min, max, ...(unit ? { unit } : {}) }, 'number');
function choices(section: string, path: string, label: string, helpText: string, entity: 'Group' | 'Command family') {
  return {
    ...control(section, path, label, helpText, { type: 'array', items: { type: 'string' } }, 'entity-picker'),
    ui: { widget: 'entity-picker', label: entity, helpText, ...(entity === 'Command family'
      ? { dynamicOptions: { source: 'command-families', filter: { newcomerGuideEligible: true } } } : {}) }
  };
}

const WELCOME = 'Welcome';
const GUIDE = 'Guide and invitation';
const DELIVERY = 'Late welcomes and delivery';
const RETURN = 'Returning members';

export const onboardingControls: OnboardingControl[] = [
  { ...toggle('Updates', 'enabled', 'Enable onboarding and updates', 'Welcome newcomers and manage update editions in this scope.'),
    ui: { widget: 'builder', helpText: 'Preview the member message and eligible audience before publishing an update.', builderId: 'official.onboarding.editions.v1', builderEndpoints: {
      state: '/api/v1/plugins/official.onboarding/:scopeId/editions', edit: '/api/v1/plugins/official.onboarding/:scopeId/editions' } } },
  message(WELCOME, 'welcome.text', 'Welcome', 'The first private message a newcomer receives. Leave empty to use the default welcome.', 2000, true),
  choices(WELCOME, 'exemptGroupChatIds', 'Exempt groups', 'Joining one of these groups does not trigger a welcome.', 'Group'),
  toggle(GUIDE, 'guide.enabled', 'Getting-started guide', 'Send newcomers a short guide to the commands they can use here.'),
  number(GUIDE, 'guide.maxEntries', 'Maximum guide entries', 'Maximum number of commands to include in the guide.', 1, 50),
  choices(GUIDE, 'guide.includeFamilies', 'Include command families', 'Leave empty to include all available families.', 'Command family'),
  choices(GUIDE, 'guide.excludeFamilies', 'Exclude command families', 'Omit these families from the guide.', 'Command family'),
  toggle(GUIDE, 'invitation.enabled', 'Account invitation', 'Send newcomers the account invitation below.'),
  message(GUIDE, 'invitation.text', 'Invitation text', 'Tell newcomers how and where to create an account. Leave empty to skip the invitation.', 2000, true),
  toggle(GUIDE, 'invitation.skipLinked', 'Skip linked accounts', 'Skip the invitation when the person already has a linked account.'),
  toggle(RETURN, 'welcomeBack.enabled', 'Welcome returning members', 'Welcome people back after they have left every group here and returned.'),
  message(RETURN, 'welcomeBack.text', 'Welcome back text', 'Leave empty to use the default welcome back.', 1000, true),
  number(RETURN, 'welcomeBack.minAbsenceDays', 'Minimum absence', 'Days away before a returning member receives this message.', 0, 3650, 'days'),
  message(DELIVERY, 'catchUp.intro', 'Late welcome opening', 'Opening for people who were here before onboarding started. Leave empty to use the default opening.', 2000, true),
  number(DELIVERY, 'catchUp.batchSize', 'Recipients per batch', 'Applies to late welcomes and automatic private updates.', 1, 20),
  number(DELIVERY, 'catchUp.intervalMinutes', 'Time between batches', 'Pause between batches of late welcomes or private updates.', 1, 240, 'minutes'),
  control(DELIVERY, 'catchUp.sendFrom', 'Delivery starts at', 'Earliest local time (HH:MM) for late welcomes and automatic private updates.', { type: 'string', max: 5 }, 'text'),
  control(DELIVERY, 'catchUp.sendUntil', 'Delivery ends at', 'Latest local time (HH:MM) for late welcomes and automatic private updates.', { type: 'string', max: 5 }, 'text')
];

export { onboardingConfigPaths };
