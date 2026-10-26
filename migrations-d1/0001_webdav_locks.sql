CREATE TABLE webdav_locks (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX webdav_locks_expiry ON webdav_locks(expires_at);
