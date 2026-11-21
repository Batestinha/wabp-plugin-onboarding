import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { registerOnboardingCommands } from './commands';
import { createOnboardingHooks } from './hooks';
import { onboardingManifest } from './manifest';

export const onboardingPlugin: ManagedGroupPlugin = {
  manifest: onboardingManifest,
  registerCommands(context) {
    registerOnboardingCommands(context);
  },
  registerHooks(context) {
    return createOnboardingHooks(context as unknown as Parameters<typeof createOnboardingHooks>[0]);
  }
};

export default onboardingPlugin;
