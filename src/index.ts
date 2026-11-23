import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { registerOnboardingCommands } from './commands';
import { createOnboardingHooks } from './hooks';
import { onboardingManifest } from './manifest';

import { editionConsole, editionExternalActions, editionServices } from './updateOperations';

export const onboardingPlugin: ManagedGroupPlugin = {
  manifest: onboardingManifest,
  registerConsoleOperations: editionConsole,
  registerServices: editionServices,
  registerExternalActions: editionExternalActions,
  registerCommands(context) {
    registerOnboardingCommands(context);
  },
  registerHooks(context) {
    return createOnboardingHooks(context as unknown as Parameters<typeof createOnboardingHooks>[0]);
  }
};

export default onboardingPlugin;
