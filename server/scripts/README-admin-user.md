# Admin accounts over SSH

`server/scripts/admin-user.js` is the supported way to create and manage admin
accounts. On the server:

```bash
cd /var/www/mitm-fa/server
node scripts/admin-user.js <command> [options]
```

## Why not SQL

An account is not just a row. The password must be bcrypt-hashed at the cost
`login-password` checks against, `role` and `status` must be strings the
middleware actually tests for, and the event belongs in `SystemLog` like every
other account change. This script imports all of that from the application
(`src/lib/password.js`, `src/lib/adminLog.js`), so it cannot drift from what the
app expects. Hand-written SQL drifts silently: a wrong cost or an unrecognised
role produces a row that looks correct and cannot log in.

## Commands

### Create an admin

Interactive (password prompted, hidden, asked twice):

```bash
node scripts/admin-user.js create --email jane@example.com --name "Jane Doe"
```

With a generated password, printed once:

```bash
node scripts/admin-user.js create --email jane@example.com --name "Jane Doe" --generate --yes
```

For automation (nothing sensitive in argv or shell history):

```bash
ADMIN_USER_PASSWORD='…' node scripts/admin-user.js create \
  --email jane@example.com --name "Jane Doe" --yes
```

Create a manager (dashboard shell + promotions view only) or a plain customer:

```bash
node scripts/admin-user.js create --email m@example.com --name M --role manager --generate --yes
```

### List

```bash
node scripts/admin-user.js list
node scripts/admin-user.js list --admins-only
node scripts/admin-user.js list --admins-only --json
```

`PW` shows whether a password is set at all — an account created by magic link
has none and can only sign in by email link until one is set.

### Promote / demote

```bash
node scripts/admin-user.js promote --email jane@example.com     # -> admin
node scripts/admin-user.js demote  --email jane@example.com     # -> customer
```

Takes effect immediately, including for sessions that are already signed in:
the role is read from the database on every request.

### Reset a password

```bash
node scripts/admin-user.js reset-password --email jane@example.com               # prompt
node scripts/admin-user.js reset-password --email jane@example.com --generate --yes
```

Existing sessions are **not** revoked by a password change. To force a signout,
disable and re-enable the account, or delete its `Session` rows.

### Disable / enable

```bash
node scripts/admin-user.js disable --email jane@example.com    # status -> suspended
node scripts/admin-user.js enable  --email jane@example.com    # status -> active
```

A suspended account is refused at login with the same generic
"Invalid email or password" as a wrong password — deliberately, so the response
does not confirm that the address exists. Existing sessions are not revoked.

## Options

| Option | Effect |
| --- | --- |
| `--yes` | skip the confirmation prompt |
| `--dry-run` | connect, validate, print the intended change, write nothing |
| `--generate` | generate a 24-character password, printed once to stdout |
| `--json` | machine-readable output (`list` only) |

Password precedence: `--password` → `ADMIN_USER_PASSWORD` → `--generate` →
hidden interactive prompt. Prefer the environment variable or `--generate`;
`--password` puts the value in your shell history.

Exit code is 0 on success and non-zero on failure. Errors go to stderr.

## Read-only SQL, for emergencies

```sql
-- Every admin/manager account: who they are and when they last signed in.
SELECT email, role, status, "createdAt", "lastLoginAt",
       ("passwordHash" IS NOT NULL) AS has_password
FROM "User"
WHERE role IN ('admin', 'manager')
ORDER BY role, "createdAt";
```

```sql
-- One account's full state, including everything hanging off it.
SELECT u.id, u.email, u.name, u.role, u.status,
       ("passwordHash" IS NOT NULL) AS has_password,
       u."createdAt", u."lastLoginAt",
       (SELECT count(*) FROM "Session" s WHERE s."userId" = u.id) AS active_sessions,
       (SELECT count(*) FROM "Order" o WHERE o."userId" = u.id) AS orders,
       (SELECT count(*) FROM "MagicLinkToken" m WHERE m."userId" = u.id) AS magic_tokens
FROM "User" u
WHERE u.email = 'jane@example.com';
```

```sql
-- Does this account satisfy the admin condition the app evaluates?
-- middleware/auth.js: requireAdmin passes only when role = 'admin';
-- requireAdminPage additionally admits 'manager' for the dashboard shell.
SELECT email,
       (role = 'admin')                        AS passes_require_admin,
       (role IN ('admin', 'manager'))          AS can_load_dashboard,
       (status = 'active')                     AS can_log_in
FROM "User"
WHERE email = 'jane@example.com';
```

## BREAK GLASS — only when the CLI cannot run

Use these **only** if Node or the app's dependencies are broken. They change a
role on an account that already exists; both are scoped to a single email.

```sql
-- Promote an EXISTING user to admin.
UPDATE "User" SET role = 'admin' WHERE email = 'jane@example.com';

-- Revert.
UPDATE "User" SET role = 'customer' WHERE email = 'jane@example.com';
```

**Never create an account this way.** A hand-written `INSERT` has to reproduce
the bcrypt cost, the exact `role`/`status` strings, the id format and the
timestamp defaults, and nothing checks that it did. The failure is silent: the
row exists, the dashboard lists it, and the password never matches. Fix the CLI
instead — that is the whole reason it exists.
