CREATE TABLE update_drafts (
  scope_id TEXT PRIMARY KEY,
  baseline TEXT NOT NULL,
  observed TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  next_batch_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE update_editions (
  scope_id TEXT NOT NULL,
  edition INTEGER NOT NULL,
  body TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, edition)
);

CREATE TABLE update_members (
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  subscribed INTEGER NOT NULL DEFAULT 0,
  welcome_floor INTEGER NOT NULL DEFAULT 0,
  welcome_pending INTEGER NOT NULL DEFAULT 0,
  welcome_receipt_scope TEXT,
  PRIMARY KEY (scope_id, identity_id)
);

-- Keep each delivery independently so a failed older edition stays readable.
CREATE TABLE update_deliveries (
  scope_id TEXT NOT NULL,
  edition INTEGER NOT NULL,
  identity_id TEXT NOT NULL,
  requested INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'waiting', 'sent', 'stopped')),
  checked_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope_id, edition, identity_id),
  FOREIGN KEY (scope_id, edition) REFERENCES update_editions(scope_id, edition)
);
CREATE INDEX update_delivery_batch ON update_deliveries(scope_id, status, checked_at, edition, identity_id);

-- Older in-flight late welcomes predate editions and cover none of them.
ALTER TABLE catch_up_queue ADD COLUMN welcome_edition INTEGER NOT NULL DEFAULT 0;
