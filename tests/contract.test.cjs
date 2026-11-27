const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validatePluginManifest, pluginIdentityProblem } = require('@wabs/plugin-sdk/manifest');
const plugin = require('../dist/index.js').default;
const { onboardingConfigPaths, parseOnboardingConfig } = require('../dist/config');
const metadata = require('../wa-plugin.json');

test('wa-plugin.json matches the compiled manifest and declares its own title and author', () => {
  assert.equal(validatePluginManifest(plugin.manifest), plugin.manifest);
  assert.equal(metadata.schemaVersion, 3);
  assert.equal(pluginIdentityProblem(metadata.pluginId, { name: metadata.name, author: metadata.author }), undefined);
  for (const key of ['pluginId', 'name', 'author', 'version', 'coreApiRange', 'messageNamespace', 'commands', 'eventSubscriptions',
    'dangerousActions', 'backgroundJobs', 'databases', 'requiredPermissions']) {
    assert.deepEqual(plugin.manifest[key], metadata[key], key);
  }
  assert.equal(require('../package.json').version, metadata.version);
  assert.deepEqual(metadata.dangerousActions, []);
});

test('starts disabled; every setting has a console control; Portuguese covers every message', () => {
  assert.equal(parseOnboardingConfig({}).enabled, false);
  assert.deepEqual([...metadata.operatorConsole.configPaths].sort(), onboardingConfigPaths().sort());
  assert.deepEqual(metadata.operatorConsole.internalConfigPaths, []);
  const pt = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/pt-PT', metadata.messageNamespace + '.json')));
  for (const key of Object.keys(plugin.manifest.defaultMessages)) assert.ok(pt[key]?.trim(), key);
});

test('the plugin knows nothing about any particular host service', () => {
  const sources = fs.readdirSync(path.join(__dirname, '../src')).map(file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /chat ?archive|topomare/iu);
});

test('member messages declare the WABP editor and only the substitutions used at delivery', () => {
  const controls = metadata.operatorConsole.controls;
  const messages = controls.filter(control => control.ui.multiline);
  assert.deepEqual(messages.map(control => control.path).sort(),
    ['catchUp.intro', 'invitation.text', 'welcome.text', 'welcomeBack.text']);
  for (const control of messages) {
    assert.equal(control.ui.templateDialect, 'token-substitution-v1', control.path);
    assert.deepEqual((control.ui.templateVariables ?? []).map(variable => variable.token),
      ['name', 'scope'], control.path);
  }
  assert.equal(controls.find(control => control.path === 'exemptGroupChatIds').ui.widget, 'entity-picker');
  for (const path of ['guide.includeFamilies', 'guide.excludeFamilies']) {
    assert.deepEqual(controls.find(control => control.path === path).ui.dynamicOptions,
      { source: 'command-families', filter: { newcomerGuideEligible: true } });
  }
});
