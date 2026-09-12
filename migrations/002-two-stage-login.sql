CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','auditor','auditee')),
  active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS member_defaults (
  role TEXT PRIMARY KEY CHECK(role IN ('auditor','auditee')), password_hash TEXT NOT NULL
);
