-- One row per identity and scope: onboarding happens once per person per scope, never per group.
CREATE TABLE members (
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('seeded', 'existing', 'onboarded')),
  first_seen_at TEXT NOT NULL,
  onboarded_at TEXT,
  left_scope_at TEXT,
  left_voluntarily INTEGER NOT NULL DEFAULT 0,
  -- 1 when the welcome went out later, through the one-time catch-up for people who were already here.
  late INTEGER NOT NULL DEFAULT 0,
  catch_up_skipped_at TEXT,
  PRIMARY KEY (scope_id, identity_id)
);
CREATE INDEX members_scope_status ON members (scope_id, status);

-- Current members are recorded once per scope before any decision, so enabling never welcomes them.
-- The one-time catch-up for people who were here before onboarding: one per scope, paced by a job.
CREATE TABLE catch_up (
  scope_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'finished')),
  started_by_identity_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sent INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  -- The scope's groups when it started, to re-check membership at send time.
  groups_json TEXT NOT NULL DEFAULT '[]'
);

-- Late welcomes prepared when the catch-up starts (where the /help guide is available) and sent by
-- a paced job. Texts are fixed at start.
CREATE TABLE catch_up_queue (
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  delivery_chat_id TEXT NOT NULL,
  addresses_json TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  sent_at TEXT,
  skipped_at TEXT,
  PRIMARY KEY (scope_id, identity_id)
);

CREATE TABLE scopes (
  scope_id TEXT PRIMARY KEY,
  seeded_at TEXT NOT NULL,
  seeded_count INTEGER NOT NULL
);
