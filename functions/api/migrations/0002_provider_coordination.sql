ALTER TABLE provider_monthly_usage ADD COLUMN next_allowed_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS provider_quote_cache (
  provider TEXT PRIMARY KEY NOT NULL,
  quotes_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
