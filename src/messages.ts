import type { MessageCatalog } from '@wabs/plugin-sdk/i18n';
import { ONBOARDING_NAMESPACE as ns } from './constants';

export const onboardingMessages: MessageCatalog = {
  [`${ns}.description`]: 'Welcome people the first time they arrive: rules, a short guide to what they can do, and an optional account invitation.',
  [`${ns}.help.family`]: 'Onboarding',
  [`${ns}.help.feature.title`]: 'Welcome and rules',
  [`${ns}.help.feature.summary`]: 'See the group rules and what newcomers receive.',
  [`${ns}.help.rules.title`]: 'Group rules',
  [`${ns}.help.rules.summary`]: 'Show the rules of this community or group.',
  [`${ns}.help.rules.instruction`]: 'Send /rules to see the rules at any time.',
  [`${ns}.help.rules.example`]: '/rules',
  [`${ns}.help.manage.title`]: 'Manage onboarding',
  [`${ns}.help.manage.summary`]: 'Preview the welcome, see counts, or send it again to someone.',
  [`${ns}.help.manage.instruction`]: 'Use /onboarding preview to receive the welcome yourself, /onboarding status for counts, and /onboarding resend @member to send it again.',
  [`${ns}.help.manage.example`]: '/onboarding resend @Ana',
  [`${ns}.help.cmd.rules`]: 'Show the rules.',
  [`${ns}.help.cmd.preview`]: 'Send the welcome to yourself.',
  [`${ns}.help.cmd.status`]: 'Show onboarding counts.',
  [`${ns}.help.cmd.resend`]: 'Send the welcome to a member again.',

  [`${ns}.welcome.default`]: 'Welcome to {scope}, {name}! Glad to have you here.',
  [`${ns}.rules.header`]: 'Our rules:',
  [`${ns}.guide.intro`]: 'Here is what you can do here:',
  [`${ns}.guide.footer`]: 'Send /help here any time to see everything, step by step.',
  [`${ns}.welcomeBack.default`]: 'Welcome back to {scope}, {name}!',

  [`${ns}.disabled`]: 'Onboarding is not switched on here.',
  [`${ns}.unavailable`]: 'Onboarding storage is not available right now. Try again in a moment.',
  [`${ns}.rules.none`]: 'No rules have been written for here yet.',
  [`${ns}.preview.sent`]: 'I sent you the welcome privately.',
  [`${ns}.status`]: 'Onboarding is {state}. Welcomed: {onboarded}. Already here when it started: {seeded}. Joined from another group here: {existing}.',
  [`${ns}.state.on`]: 'on',
  [`${ns}.state.off`]: 'off',
  [`${ns}.resend.done`]: 'I sent the welcome to {member} again.',
  [`${ns}.resend.usage`]: 'Mention the member, or reply to one of their messages.',
  [`${ns}.resend.unknown`]: 'I could not identify that member.'
};
