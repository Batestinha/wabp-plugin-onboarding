-- One row per identity and scope: onboarding happens once per person per scope, never per group.
CREATE TABLE members (
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('seeded', 'existing', 'onboarded')),
  first_seen_at TEXT NOT NULL,
  onboarded_at TEXT,
  left_scope_at TEXT,
  left_voluntarily INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope_id, identity_id)
);
CREATE INDEX members_scope_status ON members (scope_id, status);

-- Current members are recorded once per scope before any decision, so enabling never welcomes them.
CREATE TABLE scopes (
  scope_id TEXT PRIMARY KEY,
  seeded_at TEXT NOT NULL,
  seeded_count INTEGER NOT NULL
);
