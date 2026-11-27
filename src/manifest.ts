import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { onboardingConfigSchema } from './config';
import {
  CATCH_UP_JOB,
  ONBOARDING_COMMANDS,
  ONBOARDING_CORE_API_RANGE,
  ONBOARDING_DATABASE,
  ONBOARDING_MANAGE_PERMISSION,
  ONBOARDING_NAMESPACE as ns,
  ONBOARDING_PLUGIN_ID,
  ONBOARDING_VERSION
} from './constants';
import { onboardingMessages } from './messages';

import { deliveryService, editionActions, editionConsoleOperations } from './updateOperations';
import { UPDATE_JOB } from './updateDelivery';

import { updatesOffer, updatesService } from './subscriptions';

export const onboardingManifest: PluginManifest = {
  ...{ operationCatalogVersion: require('../wa-plugin.json').operationCatalogVersion, operationPermissions: require('../wa-plugin.json').operationPermissions },
  pluginId: ONBOARDING_PLUGIN_ID,
  name: 'Onboarding & Updates',
  author: { name: 'Batestinha', url: 'https://github.com/Batestinha' },
  kind: 'managed_group',
  version: ONBOARDING_VERSION,
  coreApiRange: ONBOARDING_CORE_API_RANGE,
  messageNamespace: ns,
  descriptionKey: `${ns}.description`,
  defaultMessages: onboardingMessages,
  commands: ONBOARDING_COMMANDS,
  help: {
    featureId: 'onboarding',
    titleKey: `${ns}.help.feature.title`,
    summaryKey: `${ns}.help.feature.summary`,
    order: 15,
    aliases: ['Welcome and rules', 'Boas-vindas e regras', 'Onboarding', 'welcome', 'boas-vindas', 'onboarding'],
    topics: [
      {
        topicId: 'scope-updates', titleKey: ns + '.help.updates.title', summaryKey: ns + '.help.cmd.updates',
        order: 15, commands: ['/updates'], instructionKeys: [ns + '.editions.invitation'], exampleKeys: [ns + '.help.updates.example'],
        keywords: ['updates', 'novidades'], availability: { invocation: 'either', requiresCurrentManagedGroupMembership: true, currentManagedGroupMembershipMode: 'effective_scope' }
      },
      {
        topicId: 'manage-onboarding',
        titleKey: `${ns}.help.manage.title`,
        summaryKey: `${ns}.help.manage.summary`,
        order: 20,
        commands: ['/onboarding preview', '/onboarding status', '/onboarding resend', '/onboarding catch-up'],
        instructionKeys: [`${ns}.help.manage.instruction`],
        exampleKeys: [`${ns}.help.manage.example`],
        keywords: ['welcome', 'newcomer', 'onboarding'],
        availability: { invocation: 'either', permission: ONBOARDING_MANAGE_PERMISSION }
      }
    ]
  },
  eventSubscriptions: ['participant.change', 'plugin.job'],
  requiredPermissions: [ONBOARDING_MANAGE_PERMISSION],
  requiredBotCapabilities: [],
  configSchema: onboardingConfigSchema,
  dangerousActions: [],
  backgroundJobs: [CATCH_UP_JOB, UPDATE_JOB, 'scope.configuration.changed', 'scope.help.changed'],
  memberSubscriptions: [updatesOffer],
  services: [deliveryService, updatesService],
  externalActions: editionActions,
  consoleOperations: editionConsoleOperations,
  databases: [{ name: ONBOARDING_DATABASE, engine: 'sqlite', scope: 'account', migrations: 'migrations/onboarding' }],
  dataVersion: '2',
  dependencies: [],
  integrations: [{ pluginId: 'official.community-admin', versionRange: '>=1.1.0', description: 'Communicates the published group rules in welcomes and update drafts.' }],
  cancellation: { workflows: [] },
  assistant: {
    summary: 'Welcomes people once, on their first arrival in a scope (a community or standalone groups): a private welcome with the rules, a guide built from /help, and an optional account invitation.',
    useCases: [
      'Welcome newcomers privately, once per scope, never again when they join another group of it.',
      'Read published updates with /updates or subscribe with /updates on.',
      'Include the group rules published by Group Administration Assistant in welcomes.',
      'Preview the welcome or send it again to someone.',
      'Once, send a paced late welcome to everyone who was here before onboarding started.'
    ],
    prerequisites: ['enabled=true in the target scope.', 'Groups in ASSIST or MANAGE mode, so the bot may send messages.', 'WABP core API 0.3.30 or later for update delivery receipts and member topic IDs.'],
    limitations: [
      'Current members are recorded when it starts and are never welcomed.',
      'People added back by the bot (for example after a suspension) get nothing.',
      'Group history is sent separately, per group, by Archive Courier.'
    ],
    workflows: [
      { intent: 'onboarding_manage', description: 'Preview, count or resend the welcome.', commands: ['/onboarding preview', '/onboarding status', '/onboarding resend'] },
      { intent: 'onboarding_catch_up', description: 'Send the late welcome to people who were already here, once and paced.', commands: ['/onboarding catch-up'] }
    ]
  }
};
