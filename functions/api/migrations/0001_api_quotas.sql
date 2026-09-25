CREATE TABLE IF NOT EXISTS api_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  session_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_hash, route, window_start)
);

CREATE TABLE IF NOT EXISTS provider_monthly_usage (
  provider TEXT NOT NULL,
  month_key TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, month_key)
);

CREATE INDEX IF NOT EXISTS api_sessions_expiry_idx ON api_sessions (expires_at);
