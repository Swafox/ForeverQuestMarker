-- ForeverQuest Marker community pipeline schema.
-- Timestamps are Unix seconds (UTC). No raw IP addresses or character data are stored.

-- One row per accepted export. The request body itself is not kept.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  addon_version TEXT NOT NULL,
  build TEXT NOT NULL,
  interface INTEGER NOT NULL,
  locale TEXT NOT NULL,
  exported_at INTEGER NOT NULL,
  body_bytes INTEGER NOT NULL,
  quest_count INTEGER NOT NULL,
  inserted_count INTEGER NOT NULL,
  updated_count INTEGER NOT NULL
);
CREATE INDEX submissions_client ON submissions (client_id, received_at);
CREATE INDEX submissions_received ON submissions (received_at);

-- Latest observation of one quest by one addon installation. A resubmission
-- updates the row instead of adding a report.
CREATE TABLE observations (
  client_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,        -- network of the first report; never updated
  submission_id TEXT NOT NULL,  -- last submission that changed the row
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  level INTEGER,
  giver_type TEXT,
  giver_id INTEGER,
  giver_name TEXT,
  map INTEGER,
  x REAL,
  y REAL,
  faction TEXT,
  contexts TEXT NOT NULL,       -- comma-separated
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  seen_count INTEGER NOT NULL,
  accepted INTEGER,
  turned_in INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, quest_id)
) WITHOUT ROWID;

-- Vote counters derived from observations, maintained incrementally on ingest.
-- dimension: title, level and giver are per locale; map uses locale ''.
CREATE TABLE quest_votes (
  quest_id INTEGER NOT NULL,
  dimension TEXT NOT NULL,
  locale TEXT NOT NULL,
  value TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (quest_id, dimension, locale, value)
) WITHOUT ROWID;

-- Reporting installations per quest and hashed network (IPv4 address or IPv6 /64).
CREATE TABLE quest_networks (
  quest_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  reporters INTEGER NOT NULL,
  PRIMARY KEY (quest_id, ip_hash)
) WITHOUT ROWID;

-- Materialized per-quest aggregate and candidate state.
CREATE TABLE quests (
  quest_id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,       -- candidate, known, classic, sod or era at the last update
  status TEXT,                  -- candidates only: pending, confirmed, flagged or rejected
  status_source TEXT,           -- auto or admin
  status_reason TEXT,
  status_changed_at INTEGER,
  reporters INTEGER NOT NULL,   -- distinct client IDs
  networks INTEGER NOT NULL,    -- distinct IP hashes
  summary TEXT NOT NULL,        -- JSON QuestSummary (src/summary.ts)
  first_reported INTEGER NOT NULL,
  last_reported INTEGER NOT NULL
);
CREATE INDEX quests_status ON quests (status) WHERE status IS NOT NULL;
CREATE INDEX quests_category ON quests (category);

-- Append-only record of every candidate status change. The Worker never
-- updates or deletes rows here.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  actor TEXT NOT NULL,          -- auto, or admin:<reviewer>
  from_status TEXT,
  to_status TEXT,
  reason TEXT NOT NULL,
  submission_id TEXT
);
CREATE INDEX audit_log_quest ON audit_log (quest_id, id);

-- Sliding-window rate limit counters keyed by bucket (ip:<hash> or client:<id>).
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
) WITHOUT ROWID;
CREATE INDEX rate_limits_window ON rate_limits (window_start);

-- Optimistic concurrency guard: every write batch claims the next sequence
-- number first, so a concurrent writer fails with a UNIQUE conflict and retries.
CREATE TABLE write_sequence (
  seq INTEGER PRIMARY KEY
);
