const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../dist').default;
const { host, person, event } = require('./helpers.cjs');

const ana = person('Ana', '351910000001');
const rui = person('Rui', '351910000002');
const zoe = person('Zoe', '351910000003');

function community(config) {
  const groups = [
    { groupWid: 'parent@g.us', name: 'Climbers', members: [ana] },
    { groupWid: 'main@g.us', name: 'Main', members: [ana] },
    { groupWid: 'event@g.us', name: 'Saturday', members: [] }
  ];
  const h = host({ groups, config: { rules: { text: 'Be kind.' }, invitation: { enabled: true, text: 'Create your account: https://example.org/join' }, ...config } });
  h.remember(rui); h.remember(zoe);
  return { h, hooks: plugin.registerHooks(h.context), groups };
}
const join = (groups, groupWid, who) => groups.find(group => group.groupWid === groupWid).members.push(who);
const leave = (groups, groupWid, who) => { const group = groups.find(item => item.groupWid === groupWid); group.members = group.members.filter(member => member !== who); };
const texts = actions => (actions ?? []).filter(action => action.type === 'message.sendText').map(action => action.text);

test('enabling seeds current members, who are never welcomed', async () => {
  const { h, hooks, groups } = community();
  join(groups, 'event@g.us', ana);
  const result = await hooks.onParticipantChange(event(h, 'join', 'event@g.us', ana));
  assert.deepEqual(texts(result), []);
});

test('a first arrival in the community is welcomed once, privately, with rules, the /help guide and the invitation', async () => {
  const { h, hooks, groups } = community();
  join(groups, 'parent@g.us', rui);
  const result = await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui));
  const sends = result.filter(action => action.type === 'message.sendText');
  assert.equal(sends.length, 3);
  assert.ok(sends.every(action => action.chatId === rui.deliveryChatId));
  assert.match(sends[0].text, /^Welcome to Climbers, Rui!.*\n\nOur rules:\nBe kind\.$/su);
  assert.deepEqual(sends[0].privateDeliveryFallback, { chatId: 'parent@g.us', mentionedWids: [rui.mentionWid] });
  assert.match(sends[1].text, /^Here is what you can do here:\n\nStickers\n1\. \/stickers send.*\n\nSend \/help here any time/su);
  assert.deepEqual(h.guideCalls[0], { scopeId: 'scope-1', identityId: rui.identityId, groupId: 'parent@g.us', groupWid: 'parent@g.us',
    maxEntries: 12, includeFamilies: [], excludeFamilies: [] });
  assert.equal(sends[2].text, 'Create your account: https://example.org/join');

  // Joining a sub-group later (and duplicate events) never welcomes again; group history is another plugin's job.
  join(groups, 'event@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', rui))), []);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui))), []);
});

function communityWithMirrors(config) {
  const groups = [
    { groupWid: 'parent@g.us', name: 'Climbers', members: [ana] },
    { groupWid: 'announce@g.us', name: 'Climbers', members: [ana] },
    { groupWid: 'main@g.us', name: 'Main', members: [ana] },
    { groupWid: 'event@g.us', name: 'Saturday', members: [] }
  ];
  const h = host({ groups, config: { rules: { text: 'Be kind.' }, ...config } });
  h.context.communityGroupWidForScope = async () => 'parent@g.us';
  h.context.communityAnnouncementGroupWidForScope = async () => 'announce@g.us';
  h.remember(rui);
  return { h, hooks: plugin.registerHooks(h.context), groups };
}

test('a community newcomer is welcomed although WhatsApp also put them in the community and announcement groups', async () => {
  const { h, hooks, groups } = communityWithMirrors();
  // Joining a subgroup makes WhatsApp add Rui to the community and its announcement group at the same moment.
  join(groups, 'main@g.us', rui); join(groups, 'parent@g.us', rui); join(groups, 'announce@g.us', rui);
  // The mirror events can arrive first; they decide nothing.
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'add', 'announce@g.us', rui))), []);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'add', 'parent@g.us', rui))), []);
  const welcome = texts(await hooks.onParticipantChange(event(h, 'join', 'main@g.us', rui)));
  assert.equal(welcome.length, 2);
  assert.match(welcome[0], /^Welcome to Climbers, Rui!/u);
  // Once only.
  join(groups, 'event@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', rui))), []);
});

test('leaving every subgroup counts as leaving the community, even while WhatsApp keeps the mirror memberships', async () => {
  const { h, hooks, groups } = communityWithMirrors({ welcomeBack: { minAbsenceDays: 0 } });
  join(groups, 'main@g.us', rui); join(groups, 'parent@g.us', rui); join(groups, 'announce@g.us', rui);
  await hooks.onParticipantChange(event(h, 'join', 'main@g.us', rui));
  leave(groups, 'main@g.us', rui);
  await hooks.onParticipantChange(event(h, 'leave', 'main@g.us', rui, { actor: rui }));
  join(groups, 'main@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'main@g.us', rui))), ['Welcome back to Climbers, Rui!']);
});

test('a returning member whose join request the bot approved gets the welcome back', async () => {
  const { h, hooks, groups } = communityWithMirrors({ welcomeBack: { minAbsenceDays: 0 } });
  join(groups, 'main@g.us', rui); join(groups, 'parent@g.us', rui); join(groups, 'announce@g.us', rui);
  await hooks.onParticipantChange(event(h, 'join', 'main@g.us', rui, { actor: h.bot }));
  leave(groups, 'main@g.us', rui);
  await hooks.onParticipantChange(event(h, 'leave', 'main@g.us', rui, { actor: rui }));
  join(groups, 'main@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'main@g.us', rui, { actor: h.bot }))), ['Welcome back to Climbers, Rui!']);
});

test('someone already in another group of the scope is not a newcomer', async () => {
  const { h, hooks, groups } = community();
  await hooks.onParticipantChange(event(h, 'join', 'main@g.us', ana)); // seeds the scope
  join(groups, 'main@g.us', zoe); // Zoe was added while onboarding was off for her (no event seen)
  h.context.currentMemberIdentityIdsForScope = async () => { throw new Error('already seeded'); };
  join(groups, 'event@g.us', zoe);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', zoe))), []);
});

test('the invitation is skipped for linked accounts', async () => {
  const { h, hooks, groups } = community();
  h.context.identityAccess = { hasLinkedAccount: async id => id === rui.identityId };
  join(groups, 'parent@g.us', rui);
  const sends = texts(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui)));
  assert.equal(sends.length, 2);
  assert.ok(!sends.some(text => text.includes('Create your account')));
});

test('without guide entries the /help line joins the welcome', async () => {
  const { h, hooks, groups } = community();
  h.context.newcomerGuideFor = async () => [];
  join(groups, 'parent@g.us', rui);
  const sends = texts(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui)));
  assert.match(sends[0], /Send \/help here any time/u);
  assert.equal(sends.length, 2);
});

test('bot re-adds after a suspension never welcome; a newcomer the bot let in (an approved request) is welcomed', async () => {
  const { h, hooks, groups } = community();
  join(groups, 'parent@g.us', rui);
  await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui));
  for (const group of ['parent@g.us']) leave(groups, group, rui);
  await hooks.onParticipantChange(event(h, 'remove', 'parent@g.us', rui, { actor: h.bot }));
  join(groups, 'parent@g.us', rui);
  h.setNow(new Date('2027-06-01T12:00:00Z'));
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'add', 'parent@g.us', rui, { actor: h.bot }))), []);
  // Approval on, only the bot as admin: the newcomer's arrival is performed by the bot.
  join(groups, 'event@g.us', zoe);
  const welcomed = texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', zoe, { actor: h.bot })));
  assert.match(welcomed[0], /^Welcome to Climbers, Zoe!/u);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', zoe, { actor: h.bot }))), [], 'once');
});

test('a voluntary leave of the whole scope gets a short welcome back only after the absence', async () => {
  const { h, hooks, groups } = community();
  join(groups, 'parent@g.us', rui);
  await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui));
  leave(groups, 'parent@g.us', rui);
  await hooks.onParticipantChange(event(h, 'leave', 'parent@g.us', rui, { actor: rui }));
  h.setNow(new Date('2026-11-23T12:00:00Z'));
  join(groups, 'parent@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui))), [], 'two days is too soon');
  leave(groups, 'parent@g.us', rui);
  await hooks.onParticipantChange(event(h, 'leave', 'parent@g.us', rui, { actor: rui }));
  h.setNow(new Date('2027-01-15T12:00:00Z'));
  join(groups, 'parent@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui))), ['Welcome back to Climbers, Rui!']);
});

test('leaving one sub-group is not leaving the scope', async () => {
  const { h, hooks, groups } = community({ welcomeBack: { minAbsenceDays: 0 } });
  join(groups, 'parent@g.us', rui); join(groups, 'event@g.us', rui);
  await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', rui));
  leave(groups, 'event@g.us', rui);
  await hooks.onParticipantChange(event(h, 'leave', 'event@g.us', rui, { actor: rui }));
  join(groups, 'event@g.us', rui);
  assert.deepEqual(texts(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', rui))), []);
});

test('a standalone group works the same way', async () => {
  const groups = [{ groupWid: 'solo@g.us', name: 'Solo', members: [ana] }];
  const h = host({ groups });
  h.remember(rui);
  const hooks = plugin.registerHooks(h.context);
  groups[0].members.push(rui);
  const sends = texts(await hooks.onParticipantChange(event(h, 'join', 'solo@g.us', rui)));
  assert.match(sends[0], /^Welcome to Climbers, Rui!/u);
  assert.equal(h.guideCalls[0].groupWid, 'solo@g.us');
});

test('exempt groups and a disabled plugin do nothing', async () => {
  const { h, hooks, groups } = community({ exemptGroupChatIds: ['event@g.us'] });
  join(groups, 'event@g.us', rui);
  assert.equal(await hooks.onParticipantChange(event(h, 'join', 'event@g.us', rui)), undefined);
  h.context.configFor = async () => ({ enabled: false });
  join(groups, 'parent@g.us', zoe);
  assert.equal(await hooks.onParticipantChange(event(h, 'join', 'parent@g.us', zoe)), undefined);
});

test('/rules shows the rules; /onboarding resend and preview send the welcome privately', async () => {
  const { h } = community();
  plugin.registerCommands(h.context);
  const ctx = (actor, extra = {}) => ({ scopeId: 'scope-1', groupWid: 'main@g.us', groupId: 'main@g.us', t: require('./helpers.cjs').t,
    actor: { identityAddress: actor }, message: { mentions: [] }, command: { mentions: [], args: [] }, ...extra });
  assert.equal((await h.commands.get('rules *')(ctx(rui))).text, 'Our rules:\nBe kind.');
  const resend = await h.commands.get('onboarding resend')(ctx(ana, { command: { mentions: [rui.canonicalWid], args: [] } }));
  assert.match(resend.text, /sent the welcome to Rui again/u);
  assert.ok(resend.pluginActions.filter(action => action.type === 'message.sendText').every(action => action.chatId === rui.deliveryChatId));
  const preview = await h.commands.get('onboarding preview')(ctx(ana));
  assert.ok(preview.pluginActions.every(action => action.chatId === ana.deliveryChatId));
});
