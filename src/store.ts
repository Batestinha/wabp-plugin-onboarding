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
