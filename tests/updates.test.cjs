const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../dist').default;
const { editEdition, observeDraft } = require('../dist/updateEditions');
const { allowedUpdate, markWelcomeCoverage, requestUpdates, runUpdateBatch, setSubscription } = require('../dist/updateDelivery');
const { host, person, t } = require('./helpers.cjs');

const scope = 'scope-1';
const ada = person('Ada', '351900000001');
function fixture() {
  const config = { enabled: true, rules: { text: 'Speak kindly.' }, catchUp: { batchSize: 2, intervalMinutes: 1 } };
  const h = host({ groups: [{ name: 'Walkers', groupWid: 'walkers@g.us', members: [ada] }], config });
  const receipts = new Map();
  const held = new Set();
  const topics = ['events/calendar'];
  const jobs = [];
  const deps = { ...h.context, configFor: async () => config,
    memberStandingsForScope: async () => [...held].map(identityId => ({ identityId, standing: 'suspended' })),
    privateTextReceipt: async (_scope, key) => receipts.get(key) ?? 'MISSING',
    newcomerGuideFor: async input => { assert.equal(input.result, 'topicIds'); return topics; },
    enqueuePluginJob: async job => jobs.push(job)
  };
  const db = deps.databases.open('onboarding');
  const edit = (operation = 'inspect', extra = {}) => editEdition(deps, db, { scopeId: scope, operation, ...extra });
  const tick = n => h.setNow(new Date(`2026-11-21T12:${String(n).padStart(2,'0')}:00Z`));
  return { h, deps, db, edit, config, topics, receipts, held, jobs, tick };
}
test('seeds silently, coalesces and dismisses changes, checks preview revision and publishes once', async () => {
  const f = fixture();
  const original = await f.edit();
  assert.equal(original.suggestion, '');
  f.config.rules.text = 'Bring water.';
  f.topics.push('walks/meet');
  const observed = await f.edit();
  assert.match(observed.suggestion, /rules.*\nNew in \/help: walks\/meet/u);
  f.config.rules.text = 'Bring water and a hat.';
  const changed = await f.edit();
  assert.equal(changed.suggestion, observed.suggestion);
  assert.ok(changed.revision > observed.revision);
  await assert.rejects(f.edit('dismiss', { revision: observed.revision }), /draft changed/iu);
  const dismissed = await f.edit('dismiss', { revision: changed.revision });
  assert.equal(dismissed.suggestion, '');
  const saved = await f.edit('save', { revision: dismissed.revision, body: 'Meet at 10.' });
  setSubscription(f.db, scope, ada.identityId, true);
  await assert.rejects(f.edit('publish', { revision: saved.revision, audience: 0 }), /audience changed/iu);
  const published = await f.edit('publish', { revision: saved.revision, audience: 1 });
  assert.equal(published.latest.body, 'Meet at 10.');
  assert.equal(published.latest.edition, 1);
  await assert.rejects(f.edit('publish', { revision: saved.revision, audience: 1 }), /draft changed/iu);
  assert.equal((await f.edit()).body, '');
});

test('pushes only in local hours, rechecks subscription, membership and standing, and resumes until receipt', async () => {
  const f = fixture();
  setSubscription(f.db, scope, ada.identityId, true);
  const draft = await f.edit();
  await f.edit('publish', { revision: draft.revision, audience: 1, body: 'New meet point.' });
  f.h.setNow(new Date('2026-11-21T04:00:00Z'));
  assert.ok((await runUpdateBatch(f.deps, scope)).every(a => a.type === 'plugin.enqueueJob'));
  f.tick(0);
  const [first] = await runUpdateBatch(f.deps, scope);
  assert.equal(first.type, 'message.sendText');
  assert.match(first.text, /New meet point/u);
  const guard = { ...first.deliveryCheck, recipient: ada.deliveryChatId };
  assert.ok(await allowedUpdate(f.deps, scope, guard));
  setSubscription(f.db, scope, ada.identityId, false);
  assert.equal(await allowedUpdate(f.deps, scope, guard), false);
  f.receipts.set(first.idempotencyKey, 'FAILED');
  f.tick(1);
  await runUpdateBatch(f.deps, scope);
  assert.equal(await requestUpdates(f.deps, f.db, scope, ada.identityId), 1);
  const [retry] = await runUpdateBatch(f.deps, scope);
  assert.notEqual(retry.idempotencyKey, first.idempotencyKey);
  const retryGuard = { ...retry.deliveryCheck, recipient: ada.deliveryChatId };
  assert.ok(await allowedUpdate(f.deps, scope, retryGuard));
  f.held.add(ada.identityId);
  assert.equal(await allowedUpdate(f.deps, scope, retryGuard), false);
  f.held.clear();
  f.h.groups[0].members = [];
  assert.equal(await allowedUpdate(f.deps, scope, retryGuard), false);
  f.h.groups[0].members = [ada];
  f.receipts.set(retry.idempotencyKey, 'RETRYING');
  f.tick(2);
  assert.ok((await runUpdateBatch(f.deps, scope)).every(a => a.type === 'plugin.enqueueJob'));
  f.receipts.set(retry.idempotencyKey, 'SENT');
  // A reloaded plugin opens the same database and observes the persisted receipt.
  const afterRestart = { ...f.deps };
  assert.deepEqual(await runUpdateBatch(afterRestart, scope), []);
  assert.equal(await requestUpdates(afterRestart, f.db, scope, ada.identityId), 0);
});

test('a confirmed welcome covers earlier editions and a new scope has its own opt-in', async () => {
  const f = fixture();
  await observeDraft(f.deps, f.db, scope);
  await f.edit('publish', { revision: 0, audience: 0, body: 'Published before arrival.' });
  const welcome = { type: 'message.sendText', text: 'Welcome!', chatId: ada.deliveryChatId };
  markWelcomeCoverage(f.db, scope, ada.identityId, welcome);
  f.receipts.set(welcome.idempotencyKey, 'SENT');
  assert.equal(await requestUpdates(f.deps, f.db, scope, ada.identityId), 0);
  plugin.registerCommands(f.deps);
  const command = f.h.commands.get('updates *');
  const run = (scopeId, rawArgs) => command({ scopeId, command: { rawArgs }, actor: { identityAddress: ada }, t });
  assert.match((await run(scope, 'on')).response.text, /subscribed/u);
  assert.match((await run('second', '')).response.text, /off here/u);
  const draft = await f.edit();
  await f.edit('publish', { revision: draft.revision, audience: 1, body: 'Next edition.' });
  const result = await run(scope, '');
  assert.equal(result.response.chatId, ada.deliveryChatId);
  assert.ok(result.response.disablePrivateDeliveryFallback);
  assert.ok(f.jobs.length);
  assert.match(result.response.text, /1 unread/u);
});
