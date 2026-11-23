const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { onboardingMessages } = require('../dist/messages');

function openDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-'));
  const sqlite = new DatabaseSync(path.join(dir, 'onboarding.sqlite'));
  process.once('exit', () => { if (sqlite.isOpen) sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const migrations = path.join(__dirname, '../migrations/onboarding');
  for (const file of fs.readdirSync(migrations).sort()) sqlite.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
  const db = {
    name: 'onboarding', filePath: dir,
    exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql),
    get: (sql, ...args) => sqlite.prepare(sql).get(...args), all: (sql, ...args) => sqlite.prepare(sql).all(...args),
    run: (sql, ...args) => sqlite.prepare(sql).run(...args), close: () => sqlite.close(),
    transaction(operation) { sqlite.exec('BEGIN IMMEDIATE'); try { const value = operation(); sqlite.exec('COMMIT'); return value; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }
  };
  return { open: name => { if (name !== 'onboarding') throw new Error('undeclared ' + name); return db; }, closeAll() {} };
}

function t(key, params = {}) {
  return (onboardingMessages[key] ?? key).replace(/\{([a-zA-Z]+)\}/gu, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}

function person(name, number) {
  const wid = `${number}@s.whatsapp.net`;
  return { identityId: `identity-${name}`, displayName: name, canonicalWid: wid, originalWid: wid, mentionWid: wid, deliveryChatId: wid,
    addressBookWid: wid, phoneWids: [wid], lidWids: [], aliases: [wid], dedupeKey: wid, sourceWid: wid };
}

/** Groups: { groupWid, name, members: [person] }; members are mutable so tests can move people around. */
function host({ groups, config = {}, linked = [], guide = ['Stickers\n1. /stickers send - Get the stickers.'], now = new Date('2026-11-21T12:00:00Z') }) {
  const people = new Map();
  const remember = who => { for (const address of who.aliases) people.set(address, who); };
  for (const group of groups) group.members.forEach(remember);
  const bot = person('Bot', '351900000000');
  remember(bot);
  const guideCalls = [];
  const context = {
    databases: openDatabase(),
    configFor: async () => ({ enabled: true, ...config }),
    coveredGroupsForScope: async scopeId => groups.map(group => ({ scopeId, groupId: group.groupWid, groupWid: group.groupWid, groupDisplayName: group.name, managementMode: 'MANAGE' })),
    currentMemberIdentityIdsForScope: async () => [...new Set(groups.flatMap(group => group.members.map(member => member.identityId)))],
    getGroupParticipants: async groupWid => (groups.find(group => group.groupWid === groupWid)?.members ?? []).map(member => ({ wid: member.canonicalWid, isAdmin: false, isSuperAdmin: false })),
    resolveIdentityAddress: async wid => { const who = people.get(wid); if (!who) throw new Error('unknown'); return who; },
    resolveStableIdentityById: async id => { const who = [...people.values()].find(candidate => candidate.identityId === id); if (!who) throw new Error('unknown'); return who; },
    listEnabledScopes: async () => [{ scopeId: 'scope-1', kind: 'COMMUNITY_LIKE', name: 'Climbers' }],
    newcomerGuideFor: async input => { guideCalls.push(input); return guide; },
    identityAccess: { hasLinkedAccount: async id => linked.includes(id) },
    i18n: { translatorForIdentity: async () => t, translatorForScope: async () => t, translator: () => t },
    now: () => now
  };
  const commands = new Map();
  context.router = { register(namespace, subcommand, metadata, handler) { commands.set(`${namespace} ${subcommand}`, handler); } };
  return { context, people, remember, bot, guideCalls, commands, groups, setNow: value => { now = value; } };
}

function event(h, action, groupWid, who, { actor } = {}) {
  return { pluginId: 'official.onboarding', scopeId: 'scope-1', groupWid, groupId: groupWid, managementMode: 'MANAGE', receivedAt: new Date(),
    eventId: `${action}-${Math.random()}`, chatId: groupWid, action, botIdentityIds: [h.bot.identityId],
    ...(actor ? { actorIdentity: actor } : {}), affectedIdentities: [who] };
}

module.exports = { host, person, event, t };
