import { z } from 'zod';
import type { PluginDatabase } from '@wabs/plugin-sdk/database';
import { configFor, nowFrom, scopeName, type OnboardingDeps } from './onboarding';
import { ONBOARDING_NAMESPACE as ns } from './constants';

export const editionRequest = z.object({
  scopeId: z.string().min(1), operation: z.enum(['inspect', 'save', 'dismiss', 'publish']),
  revision: z.number().int().nonnegative().optional(), body: z.string().trim().max(3000).optional(),
  audience: z.number().int().nonnegative().optional()
}).strict();

type Snapshot = { rules: string; topics: string[] | null };
type Draft = { baseline: string; observed: string; body: string; revision: number };

export async function eligibleMembers(deps: OnboardingDeps, scopeId: string): Promise<Set<string>> {
  if (!deps.currentMemberIdentityIdsForScope || !deps.memberStandingsForScope) throw new Error('Current membership and standing are unavailable.');
  const [members, held] = await Promise.all([deps.currentMemberIdentityIdsForScope(scopeId), deps.memberStandingsForScope(scopeId)]);
  const allowed = new Set(members);
  for (const standing of held) allowed.delete(standing.identityId);
  return allowed;
}

function draftRow(db: PluginDatabase, scopeId: string) {
  return db.get<Draft>('SELECT baseline, observed, body, revision FROM update_drafts WHERE scope_id = ?', scopeId);
}

/** Observe effective state. The first observation seeds the baseline and produces no suggestion. */
export async function observeDraft(deps: OnboardingDeps, db: PluginDatabase, scopeId: string, memberIds?: Set<string>) {
  const before = draftRow(db, scopeId);
  const config = await configFor(deps, scopeId);
  let topics: string[] | null = null;
  if (!config.guide.enabled) topics = [];
  else if (deps.newcomerGuideFor) {
    const members = memberIds ?? await eligibleMembers(deps, scopeId);
    const identityId = members.values().next().value;
    if (identityId) {
      const groups = await deps.coveredGroupsForScope?.(scopeId) ?? [];
      const group = groups.find(g => !config.exemptGroupChatIds.includes(g.groupWid));
      topics = [...new Set(await deps.newcomerGuideFor({ scopeId, identityId, result: 'topicIds',
        groupId: group?.groupId, groupWid: group?.groupWid, includeFamilies: config.guide.includeFamilies,
        excludeFamilies: config.guide.excludeFamilies }))].sort();
    }
  }
  const baseline: Snapshot | undefined = before && JSON.parse(before.baseline);
  const previous: Snapshot | undefined = before && JSON.parse(before.observed);
  const observed = JSON.stringify({ rules: config.rules.text.trim(), topics: topics ?? previous?.topics ?? null });
  if (!before) {
    db.run('INSERT OR IGNORE INTO update_drafts(scope_id, baseline, observed) VALUES (?, ?, ?)', scopeId, observed, observed);
  } else if (observed !== before.observed) {
    // A first member after an empty scope supplies a baseline for the guide.
    if (baseline && baseline.topics === null && topics !== null) baseline.topics = topics;
    db.run('UPDATE update_drafts SET baseline = ?, observed = ?, revision = revision + 1 WHERE scope_id = ? AND revision = ?',
      JSON.stringify(baseline), observed, scopeId, before.revision);
  }
  return draftRow(db, scopeId)!;
}

function audienceFor(db: PluginDatabase, scopeId: string, members: Set<string>): string[] {
  return db.all<{ identity_id: string }>('SELECT identity_id FROM update_members WHERE scope_id = ? AND subscribed = 1', scopeId)
    .map(row => row.identity_id).filter(id => members.has(id));
}

export async function editEdition(deps: OnboardingDeps, db: PluginDatabase, request: z.infer<typeof editionRequest>) {
  const { scopeId, operation } = request;
  if (!(await configFor(deps, scopeId)).enabled) throw new Error('Onboarding is disabled in this scope.');
  const members = await eligibleMembers(deps, scopeId);
  await observeDraft(deps, db, scopeId, members);
  const t = await deps.i18n?.translatorForScope?.(scopeId) ?? ((key: string) => key);
  const name = await scopeName(deps, scopeId);
  function preview(draft: Draft) {
    const baseline = JSON.parse(draft.baseline) as Snapshot;
    const observed = JSON.parse(draft.observed) as Snapshot;
    const added = (observed.topics ?? []).filter(topic => !baseline.topics?.includes(topic));
    const removed = (baseline.topics ?? []).filter(topic => !observed.topics?.includes(topic));
    const suggestion = [
      ...(baseline.rules !== observed.rules ? [t(ns + '.editions.rules')] : []),
      ...(added.length ? [t(ns + '.editions.added', { topics: added.join(', ') })] : []),
      ...(removed.length ? [t(ns + '.editions.removed', { topics: removed.join(', ') })] : [])
    ].join('\n');
    const latest = db.get<{edition: number; body: string; published_at: string}>(
      'SELECT edition, body, published_at FROM update_editions WHERE scope_id = ? ORDER BY edition DESC LIMIT 1', scopeId) ?? null;
    return { latest, previewTemplate: t(ns + '.editions.message', { scope: name, edition: (latest?.edition ?? 0) + 1, body: '{body}' }), revision: draft.revision, body: draft.body, suggestion, audience: audienceFor(db, scopeId, members).length };
  }
  const state = db.transaction(() => {
    const draft = draftRow(db, scopeId)!;
    if (operation === 'inspect') return preview(draft);
    if (draft.revision !== request.revision) throw new Error('The draft changed. Refresh the preview before continuing.');
    if (operation === 'save') {
      if (request.body === undefined) throw new Error('Supply the draft text.');
      db.run('UPDATE update_drafts SET body = ?, revision = revision + 1 WHERE scope_id = ?', request.body, scopeId);
    } else {
      if (operation === 'publish') {
        const recipients = audienceFor(db, scopeId, members);
        if (request.audience !== recipients.length) throw new Error('The audience changed. Refresh the preview before publishing.');
        const body = (request.body ?? draft.body).trim();
        if (!body) throw new Error('An edition needs a message.');
        const edition = (preview(draft).latest?.edition ?? 0) + 1;
        db.run('INSERT INTO update_editions(scope_id, edition, body, published_at) VALUES (?, ?, ?, ?)',
          scopeId, edition, body, nowFrom(deps).toISOString());
        const insert = db.prepare('INSERT INTO update_deliveries(scope_id, edition, identity_id) VALUES (?, ?, ?)');
        for (const identityId of recipients) insert.run(scopeId, edition, identityId);
      }
      db.run("UPDATE update_drafts SET body = '', baseline = observed, revision = revision + 1 WHERE scope_id = ?", scopeId);
    }
    return preview(draftRow(db, scopeId)!);
  });
  return state;
}
