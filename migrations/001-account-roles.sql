-- Only needed if the previous editor/viewer schema has already been applied.
-- Apply as a D1 batch/SQL file. Non-admin legacy roles are disabled until mapped by Admin.
CREATE TABLE users_roles_v2 (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','auditor','auditee')),
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO users_roles_v2(id,name,password_hash,role,active)
SELECT id,name,password_hash,
  CASE WHEN role IN ('admin','auditor','auditee') THEN role ELSE 'auditee' END,
  CASE WHEN role IN ('admin','auditor','auditee') THEN active ELSE 0 END
FROM users;
DROP TABLE users;
ALTER TABLE users_roles_v2 RENAME TO users;
