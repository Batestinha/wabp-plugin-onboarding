const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../dist').default;
const { host, person, event, t } = require('./helpers.cjs');

const members = Array.from({ length: 7 }, (_, index) => person(`M${index}`, `35191000010${index}`));
const admin = members[0];

function setup({ standings = [] } = {}) {
  const groups = [
    { groupWid: 'parent@g.us', name: 'Climbers', members: [...members] },
    { groupWid: 'main@g.us', name: 'Main', members: [...members] }
  ];
  const h = host({ groups, config: { rules: { text: 'Be kind.' } }, now: new Date('2026-11-22T11:00:00Z') });
  h.context.memberStandingsForScope = async () => standings;
  h.context.clockFor = async () => ({ timezone: 'Europe/Lisbon' });
  plugin.registerCommands(h.context);
  const hooks = plugin.registerHooks(h.context);
  const command = async (args) => h.commands.get('onboarding catch-up')({
    scopeId: 'scope-1', groupWid: 'main@g.us', t, actor: { identityAddress: admin }, message: { mentions: [] },
    command: { mentions: [], args }, remainingArgs: args
  });
  const runJob = job => hooks.onPluginJob({ pluginId: 'official.onboarding', scopeId: 'scope-1', receivedAt: new Date(), jobName: job.jobName, payload: job.payload, runAt: job.runAt });
  return { h, hooks, groups, command, runJob };
}
const sends = actions => actions.filter(action => action.type === 'message.sendText');
const job = actions => actions.find(action => action.type === 'plugin.enqueueJob');

test('preview counts everyone who never had the welcome and asks for the exact count to start', async () => {
  const { command } = setup({ standings: [{ identityId: members[6].identityId, standing: 'suspended' }] });
  const preview = await command([]);
  assert.match(preview.text, /^6 people here never had the welcome\. .*3 people every 5 minutes between 10:00 and 20:00: about 0\.1 hours.*start 6$/su);
  assert.match((await command(['start', '5'])).text, /The number has changed: it is now 6/u);
});

test('the catch-up sends in paced batches, once per person, and reports when done', async () => {
  const { h, command, runJob, groups } = setup();
  const started = await command(['start', '7']);
  assert.match(started.text, /^Started: 7 late welcomes, 3 every 5 minutes/u);
  let next = job(started.pluginActions);
  assert.equal(next.jobName, 'catch-up.batch');

  const first = await runJob(next);
  assert.equal(new Set(sends(first).map(action => action.chatId)).size, 3);
  assert.match(sends(first)[0].text, /^Hi M0! You were in Climbers before we started welcoming people here.*\n\nOur rules:\nBe kind\./su);
  assert.ok(sends(first).every(action => action.privateDeliveryFallback === undefined), 'no group mentions for late welcomes');
  next = job(first);
  assert.equal(next.runAt.getTime() - h.context.now().getTime(), 5 * 60_000);

  // Someone leaves before their turn: they are skipped, not messaged.
  for (const group of groups) group.members = group.members.filter(member => member !== members[4]);
  // The second batch skips them and takes the next person instead, which finishes the queue.
  const second = await runJob(next);
  assert.ok(!sends(second).some(action => action.chatId === members[4].deliveryChatId));
  assert.equal(new Set(sends(second).map(action => action.chatId).filter(chatId => chatId !== admin.deliveryChatId)).size, 3);
  const done = sends(second).find(action => action.chatId === admin.deliveryChatId && /done/u.test(action.text));
  assert.match(done.text, /6 sent, 1 skipped/u);
  assert.equal(job(second), undefined);

  // Nobody gets it twice; a new arrival still gets the normal welcome.
  assert.match((await command([])).text, /Everyone here has already had the welcome/u);
});

test('outside sending hours nothing goes out and the job comes back later', async () => {
  const { h, command, runJob } = setup();
  const started = await command(['start', '7']);
  h.setNow(new Date('2026-11-22T23:30:00Z'));
  const night = await runJob(job(started.pluginActions));
  assert.deepEqual(sends(night), []);
  assert.equal(job(night).runAt.toISOString(), '2026-11-23T00:00:00.000Z');
});

test('stop halts it; starting again only reaches people who did not get it', async () => {
  const { command, runJob } = setup();
  const started = await command(['start', '7']);
  await runJob(job(started.pluginActions));
  assert.match((await command(['stop'])).text, /Stopped after 3 late welcomes; 4 not sent/u);
  assert.deepEqual(await runJob(job(started.pluginActions)), []);
  assert.match((await command([])).text, /^4 people here never had the welcome/u);
});

test('new arrivals during or after the catch-up get the normal welcome, not a second one', async () => {
  const { h, hooks, groups, command, runJob } = setup();
  const newcomer = person('New', '351910000999');
  h.remember(newcomer);
  const started = await command(['start', '7']);
  groups[0].members.push(newcomer);
  const welcome = await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', newcomer));
  assert.match(sends(welcome)[0].text, /^Welcome to Climbers, New!/u);
  const batch = await runJob(job(started.pluginActions));
  assert.ok(!sends(batch).some(action => action.chatId === newcomer.deliveryChatId));
});
