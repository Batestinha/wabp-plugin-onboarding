import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { registerOnboardingCommands } from './commands';
import { createOnboardingHooks } from './hooks';
import { onboardingManifest } from './manifest';

import { updatesRegistration } from './subscriptions';
import { editionConsole, editionExternalActions, editionServices } from './updateOperations';

export const onboardingPlugin: ManagedGroupPlugin = {
  manifest: onboardingManifest,
  registerConsoleOperations: editionConsole,
  registerServices: context => [...(editionServices(context) ?? []), updatesRegistration(context)],
  registerExternalActions: editionExternalActions,
  registerCommands(context) {
    registerOnboardingCommands(context);
  },
  registerHooks(context) {
    return createOnboardingHooks(context as unknown as Parameters<typeof createOnboardingHooks>[0]);
  }
};

export default onboardingPlugin;
