// Writes wa-plugin.json from the compiled manifest so package metadata (read
// before plugin code is loaded) cannot drift from the runtime manifest.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { onboardingManifest: m } = require('../dist/manifest.js');
const { onboardingControls, onboardingConfigPaths } = require('../dist/controls.js');
const pkg = require('../package.json');

const controlled = new Set(onboardingControls.map(control => control.path));
const metadata = {
  schemaVersion: 2,
  pluginId: m.pluginId,
  name: m.name,
  author: m.author,
  description: pkg.description,
  kind: m.kind,
  version: m.version,
  coreApiRange: m.coreApiRange,
  entrypoint: 'dist/index.js',
  messageNamespace: m.messageNamespace,
  descriptionKey: m.descriptionKey,
  commands: m.commands,
  help: m.help,
  eventSubscriptions: m.eventSubscriptions,
  requiredPermissions: m.requiredPermissions,
  requiredBotCapabilities: m.requiredBotCapabilities,
  dangerousActions: m.dangerousActions,
  backgroundJobs: m.backgroundJobs,
  databases: m.databases,
  dataVersion: m.dataVersion,
  cancellation: m.cancellation,
  dependencies: m.dependencies,
  integrations: m.integrations,
  assistant: m.assistant,
  services: m.services,
  externalActions: m.externalActions,
  consoleOperations: m.consoleOperations,
  operatorConsole: {
    configPaths: onboardingConfigPaths(),
    controls: onboardingControls.map(c => ({ pluginId: m.pluginId, ...c })),
    internalConfigPaths: onboardingConfigPaths().filter(configPath => !controlled.has(configPath))
  }
};
fs.writeFileSync(path.join(root, 'wa-plugin.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('wrote wa-plugin.json', m.pluginId, m.version);
