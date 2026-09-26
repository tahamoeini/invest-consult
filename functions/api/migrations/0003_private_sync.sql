-- Apply to USER_DATA_DB only. Never apply to API_USAGE_DB.
CREATE TABLE IF NOT EXISTS sync_blobs (
  account_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  payload_json TEXT,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK ((deleted_at IS NULL AND payload_json IS NOT NULL) OR (deleted_at IS NOT NULL AND payload_json IS NULL))
);
