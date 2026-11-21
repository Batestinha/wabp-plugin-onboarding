import type { PluginDatabase } from '@wabs/plugin-sdk/database';

export type MemberStatus = 'seeded' | 'existing' | 'onboarded';

export interface MemberRow {
  scope_id: string;
  identity_id: string;
  status: MemberStatus;
  first_seen_at: string;
  onboarded_at: string | null;
  left_scope_at: string | null;
  left_voluntarily: number;
}

export function memberRow(db: PluginDatabase, scopeId: string, identityId: string): MemberRow | undefined {
  return db.get<MemberRow & Record<string, unknown>>('SELECT * FROM members WHERE scope_id = ? AND identity_id = ?', scopeId, identityId);
}

/** Inserts the row unless it exists. Returns true when this call created it (the first arrival wins). */
export function insertMember(db: PluginDatabase, scopeId: string, identityId: string, status: MemberStatus, now: Date): boolean {
  return db.run(`INSERT INTO members (scope_id, identity_id, status, first_seen_at, onboarded_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (scope_id, identity_id) DO NOTHING`,
  scopeId, identityId, status, now.toISOString(), status === 'onboarded' ? now.toISOString() : null).changes > 0;
}

export function isSeeded(db: PluginDatabase, scopeId: string): boolean {
  return Boolean(db.get('SELECT 1 AS seeded FROM scopes WHERE scope_id = ?', scopeId));
}

export function seedScope(db: PluginDatabase, scopeId: string, identityIds: readonly string[], now: Date): number {
  return db.transaction(() => {
    if (isSeeded(db, scopeId)) return 0;
    let count = 0;
    for (const identityId of new Set(identityIds)) {
      count += db.run(`INSERT INTO members (scope_id, identity_id, status, first_seen_at) VALUES (?, ?, 'seeded', ?)
        ON CONFLICT (scope_id, identity_id) DO NOTHING`, scopeId, identityId, now.toISOString()).changes;
    }
    db.run('INSERT INTO scopes (scope_id, seeded_at, seeded_count) VALUES (?, ?, ?)', scopeId, now.toISOString(), count);
    return count;
  });
}

export function markLeft(db: PluginDatabase, scopeId: string, identityId: string, voluntary: boolean, now: Date): void {
  db.run('UPDATE members SET left_scope_at = ?, left_voluntarily = ? WHERE scope_id = ? AND identity_id = ? AND left_scope_at IS NULL',
    now.toISOString(), voluntary ? 1 : 0, scopeId, identityId);
}

export function clearLeft(db: PluginDatabase, scopeId: string, identityId: string): void {
  db.run('UPDATE members SET left_scope_at = NULL, left_voluntarily = 0 WHERE scope_id = ? AND identity_id = ?', scopeId, identityId);
}

export function statusCounts(db: PluginDatabase, scopeId: string): Record<MemberStatus, number> {
  const counts: Record<MemberStatus, number> = { seeded: 0, existing: 0, onboarded: 0 };
  for (const row of db.all<{ status: MemberStatus; count: number }>('SELECT status, count(*) AS count FROM members WHERE scope_id = ? GROUP BY status', scopeId)) {
    counts[row.status] = Number(row.count);
  }
  return counts;
}

export interface CatchUpRow {
  scope_id: string;
  status: 'running' | 'stopped' | 'finished';
  started_by_identity_id: string;
  started_at: string;
  finished_at: string | null;
  sent: number;
  skipped: number;
  groups_json: string;
}

export interface QueueRow {
  scope_id: string;
  identity_id: string;
  delivery_chat_id: string;
  addresses_json: string;
  messages_json: string;
}

/** People who never had the welcome: recorded when onboarding started, or found already in another group. */
export function pendingLate(db: PluginDatabase, scopeId: string, limit = 100_000): MemberRow[] {
  return db.all<MemberRow & Record<string, unknown>>(
    `SELECT * FROM members WHERE scope_id = ? AND status IN ('seeded', 'existing') AND catch_up_skipped_at IS NULL
     ORDER BY first_seen_at ASC, identity_id ASC LIMIT ?`, scopeId, limit);
}

export function pendingLateCount(db: PluginDatabase, scopeId: string): number {
  return Number(db.get<{ count: number }>(
    `SELECT count(*) AS count FROM members WHERE scope_id = ? AND status IN ('seeded', 'existing') AND catch_up_skipped_at IS NULL`, scopeId)?.count ?? 0);
}

/** Marks the late welcome as sent; false when it already went out (so it never goes out twice). */
export function markLateOnboarded(db: PluginDatabase, scopeId: string, identityId: string, now: Date): boolean {
  return db.run(`UPDATE members SET status = 'onboarded', onboarded_at = ?, late = 1
    WHERE scope_id = ? AND identity_id = ? AND status IN ('seeded', 'existing')`, now.toISOString(), scopeId, identityId).changes > 0;
}

export function markCatchUpSkipped(db: PluginDatabase, scopeId: string, identityId: string, now: Date): void {
  db.run('UPDATE members SET catch_up_skipped_at = ? WHERE scope_id = ? AND identity_id = ?', now.toISOString(), scopeId, identityId);
  db.run('UPDATE catch_up_queue SET skipped_at = ? WHERE scope_id = ? AND identity_id = ? AND sent_at IS NULL', now.toISOString(), scopeId, identityId);
}

export function catchUpRow(db: PluginDatabase, scopeId: string): CatchUpRow | undefined {
  return db.get<CatchUpRow & Record<string, unknown>>('SELECT * FROM catch_up WHERE scope_id = ?', scopeId);
}

/** Starts (or restarts) the catch-up with freshly prepared messages; earlier unsent preparations are replaced. */
export function startCatchUp(db: PluginDatabase, input: {
  scopeId: string; actorIdentityId: string; now: Date; groups: string[];
  queue: Array<{ identityId: string; deliveryChatId: string; addresses: string[]; messages: string[] }>;
}): void {
  db.transaction(() => {
    db.run(`INSERT INTO catch_up (scope_id, status, started_by_identity_id, started_at, groups_json) VALUES (?, 'running', ?, ?, ?)
      ON CONFLICT (scope_id) DO UPDATE SET status = 'running', started_by_identity_id = excluded.started_by_identity_id,
        started_at = excluded.started_at, finished_at = NULL, groups_json = excluded.groups_json`,
    input.scopeId, input.actorIdentityId, input.now.toISOString(), JSON.stringify(input.groups));
    db.run('DELETE FROM catch_up_queue WHERE scope_id = ? AND sent_at IS NULL', input.scopeId);
    for (const item of input.queue) {
      db.run(`INSERT INTO catch_up_queue (scope_id, identity_id, delivery_chat_id, addresses_json, messages_json, prepared_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (scope_id, identity_id) DO NOTHING`,
      input.scopeId, item.identityId, item.deliveryChatId, JSON.stringify(item.addresses), JSON.stringify(item.messages), input.now.toISOString());
    }
  });
}

export function nextQueued(db: PluginDatabase, scopeId: string, limit: number): QueueRow[] {
  return db.all<QueueRow & Record<string, unknown>>(
    `SELECT * FROM catch_up_queue WHERE scope_id = ? AND sent_at IS NULL AND skipped_at IS NULL ORDER BY prepared_at, identity_id LIMIT ?`,
    scopeId, limit);
}

export function queuedCount(db: PluginDatabase, scopeId: string): number {
  return Number(db.get<{ count: number }>(
    'SELECT count(*) AS count FROM catch_up_queue WHERE scope_id = ? AND sent_at IS NULL AND skipped_at IS NULL', scopeId)?.count ?? 0);
}

export function markQueuedSent(db: PluginDatabase, scopeId: string, identityId: string, now: Date): void {
  db.run('UPDATE catch_up_queue SET sent_at = ? WHERE scope_id = ? AND identity_id = ?', now.toISOString(), scopeId, identityId);
}

export function setCatchUpStatus(db: PluginDatabase, scopeId: string, status: CatchUpRow['status'], now: Date): void {
  db.run('UPDATE catch_up SET status = ?, finished_at = ? WHERE scope_id = ?', status, status === 'running' ? null : now.toISOString(), scopeId);
}

export function countCatchUp(db: PluginDatabase, scopeId: string, sent: number, skipped: number): void {
  db.run('UPDATE catch_up SET sent = sent + ?, skipped = skipped + ? WHERE scope_id = ?', sent, skipped, scopeId);
}
