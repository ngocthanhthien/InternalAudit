PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','auditor','auditee')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS head (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT);
INSERT OR IGNORE INTO head(id,version) VALUES(1,NULL);
CREATE TABLE IF NOT EXISTS versions (
  version TEXT PRIMARY KEY, created_at INTEGER NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  version TEXT NOT NULL REFERENCES versions(version) ON DELETE CASCADE,
  part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(version,part)
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','auditor','auditee')),
  active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS member_defaults (
  role TEXT PRIMARY KEY CHECK(role IN ('auditor','auditee')), password_hash TEXT NOT NULL
);
