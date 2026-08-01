#!/usr/bin/env node
//
// ADMIN ACCOUNT MANAGEMENT, over SSH.
//
//   cd /var/www/mitm-fa/server
//   node scripts/admin-user.js <command> [options]
//
// Commands:
//   create          --email <e> --name <n> [--password <p> | --generate] [--role admin|manager|customer]
//   list            [--admins-only]
//   promote         --email <e>              # -> role admin
//   demote          --email <e>              # -> role customer
//   reset-password  --email <e> [--password <p> | --generate]
//   disable         --email <e>              # -> status suspended
//   enable          --email <e>              # -> status active
//
// Global options:
//   --yes        skip the confirmation prompt (for automation)
//   --dry-run    connect, validate, print what WOULD change, write nothing
//   --generate   generate a strong random password, printed once to stdout
//   --json       machine-readable output for `list`
//
// Password sources, in order of precedence:
//   --password <p>            (visible in shell history — prefer the others)
//   ADMIN_USER_PASSWORD=...   environment variable, for automation
//   --generate                random 24-char password, printed once
//   interactive prompt        hidden input, asked twice
//
// WHY THIS EXISTS RATHER THAN SQL: an account is not just a row. The password
// must be bcrypt-hashed at the cost the app checks against, the role and status
// strings must be ones the middleware actually recognises, and the creation
// must land in SystemLog like every other account event. All of that is
// imported from the application here — see lib/password.js and lib/adminLog.js
// — so this cannot drift from what the app expects. Hand-written SQL can, and
// silently: a wrong cost or an unrecognised role produces a row that looks
// fine and cannot log in.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const readline = require("readline");
const crypto = require("crypto");

const { prisma } = require("../src/db");
// The application's own hashing and policy. Never re-implemented here.
const { hashPassword, passwordPolicyError, MIN_PASSWORD_LENGTH } = require("../src/lib/password");
const { logEvent } = require("../src/lib/adminLog");

// The same expression routes/auth.js validates submitted emails with.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The values middleware/auth.js actually tests for. Anything else produces an
// account that exists and can never reach the dashboard.
const ROLES = ["admin", "manager", "customer"];
const STATUSES = { active: "active", suspended: "suspended" };

function fail(message, code) {
  process.stderr.write(String(message).replace(/\n?$/, "\n"));
  process.exit(code == null ? 1 : code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// 24 chars from a 64-char alphabet ~= 144 bits. Deliberately excludes quotes
// and backslashes so the value can be pasted into any shell or form without
// escaping surprises.
function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_@#%+=";
  const bytes = crypto.randomBytes(24);
  let out = "";
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Hidden input. Node gives no built-in, so the tty is put in raw mode and the
// characters are consumed without being echoed. Nothing typed here reaches the
// terminal, the shell history, or any log.
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error(
        "No terminal available for a password prompt.\n" +
        "Pass --password, set ADMIN_USER_PASSWORD, or use --generate."));
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(wasRaw);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        return resolve(value);
      }
      if (ch === "\u0003") {                      // Ctrl-C
        stdin.setRawMode(wasRaw);
        process.stdout.write("\n");
        process.exit(130);
      }
      if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); return; }
      value += ch;
    };
    stdin.on("data", onData);
  });
}

function confirm(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + " [y/N] ", (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

function normalizeEmail(raw) {
  // Same normalisation the login route applies, so an address created here
  // matches the one typed at the login form.
  return String(raw == null ? "" : raw).trim().toLowerCase();
}

function requireEmail(args) {
  const email = normalizeEmail(args.email);
  if (!email) fail("Missing --email");
  if (!EMAIL_RE.test(email)) fail(`Not a valid email address: ${email}`);
  return email;
}

// Resolves the password from every supported source, validates it against the
// application's policy, and never returns it anywhere it could be logged.
async function resolvePassword(args, { required }) {
  let password = null;
  let generated = false;

  if (typeof args.password === "string") password = args.password;
  else if (process.env.ADMIN_USER_PASSWORD) password = process.env.ADMIN_USER_PASSWORD;
  else if (args.generate) { password = generatePassword(); generated = true; }
  else if (required) {
    password = await promptHidden("New password (hidden): ");
    const again = await promptHidden("Confirm password (hidden): ");
    if (password !== again) fail("Passwords did not match. Nothing was changed.");
  }

  if (password == null) return { password: null, generated: false };

  const policyError = passwordPolicyError(password);
  if (policyError) fail(policyError);
  return { password, generated };
}

async function findUser(email) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true,
      passwordHash: true, lastLoginAt: true, createdAt: true },
  });
}

// Prints the intended change and asks, unless --yes. Returns false when the
// caller declined or --dry-run was passed, in which case NOTHING is written.
async function gate(args, title, changes) {
  console.log("\n" + title);
  for (const line of changes) console.log("  " + line);
  if (args["dry-run"]) {
    console.log("\nDRY RUN — nothing was written.");
    return false;
  }
  if (args.yes) return true;
  const ok = await confirm("\nApply this change?");
  if (!ok) console.log("Cancelled. Nothing was written.");
  return ok;
}

const fmt = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) : "never");

/* ------------------------------------------------------------- commands --- */

async function cmdCreate(args) {
  const email = requireEmail(args);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const role = typeof args.role === "string" ? args.role : "admin";
  if (ROLES.indexOf(role) === -1) fail(`Unknown role "${role}". Must be one of: ${ROLES.join(", ")}`);

  const existing = await findUser(email);
  if (existing) {
    fail(`An account already exists for ${email} (role=${existing.role}, status=${existing.status}).\n` +
         `Use "promote", "reset-password" or "enable" to change it.`);
  }

  const { password, generated } = await resolvePassword(args, { required: true });

  const ok = await gate(args, `CREATE account ${email}`, [
    `email    ${email}`,
    `name     ${name || "(none)"}`,
    `role     ${role}`,
    `status   active`,
    `password ${generated ? "generated (printed once below)" : "set (hidden)"}`,
  ]);
  if (!ok) return 0;

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash, role, status: STATUSES.active },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });

  // Same audit trail a signup writes, so an account created here is visible in
  // the admin log rather than appearing from nowhere.
  await logEvent({
    category: "user",
    message: `Admin account created via CLI: ${email} (role: ${role})`,
    metadata: { userId: user.id, role, source: "scripts/admin-user.js" },
  });

  console.log(`\nCreated ${user.email}  id=${user.id}  role=${user.role}  status=${user.status}`);
  if (generated) {
    console.log(`\nPassword (shown once, not stored anywhere in plain text):\n\n    ${password}\n`);
  }
  console.log("This account can sign in immediately at /login with email + password.");
  return 0;
}

async function cmdList(args) {
  const where = args["admins-only"] ? { role: { in: ["admin", "manager"] } } : {};
  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, name: true, role: true, status: true,
      passwordHash: true, lastLoginAt: true, createdAt: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  if (args.json) {
    // passwordHash is deliberately reduced to a boolean — this tool never
    // emits a hash, in any mode.
    console.log(JSON.stringify(users.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
      hasPassword: !!u.passwordHash, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
    })), null, 2));
    return 0;
  }

  if (!users.length) { console.log("No matching accounts."); return 0; }
  console.log(
    "ROLE".padEnd(9) + "STATUS".padEnd(11) + "PW".padEnd(5) +
    "EMAIL".padEnd(34) + "LAST LOGIN".padEnd(21) + "CREATED");
  for (const u of users) {
    console.log(
      u.role.padEnd(9) + u.status.padEnd(11) + (u.passwordHash ? "yes" : "no").padEnd(5) +
      u.email.padEnd(34) + fmt(u.lastLoginAt).padEnd(21) + fmt(u.createdAt));
  }
  console.log(`\n${users.length} account(s).`);
  return 0;
}

async function setRole(args, role, verb) {
  const email = requireEmail(args);
  const user = await findUser(email);
  if (!user) fail(`No account found for ${email}`);
  if (user.role === role) { console.log(`${email} is already role "${role}". Nothing to do.`); return 0; }

  const ok = await gate(args, `${verb.toUpperCase()} ${email}`, [
    `role     ${user.role}  ->  ${role}`,
    `status   ${user.status} (unchanged)`,
  ]);
  if (!ok) return 0;

  await prisma.user.update({ where: { id: user.id }, data: { role } });
  await logEvent({
    category: "user",
    message: `Role changed via CLI: ${email} ${user.role} -> ${role}`,
    metadata: { userId: user.id, from: user.role, to: role, source: "scripts/admin-user.js" },
  });
  console.log(`\n${email} is now role "${role}".`);
  return 0;
}

async function setStatus(args, status, verb) {
  const email = requireEmail(args);
  const user = await findUser(email);
  if (!user) fail(`No account found for ${email}`);
  if (user.status === status) { console.log(`${email} is already "${status}". Nothing to do.`); return 0; }

  const ok = await gate(args, `${verb.toUpperCase()} ${email}`, [
    `status   ${user.status}  ->  ${status}`,
    `role     ${user.role} (unchanged)`,
    status === STATUSES.suspended
      ? "effect   login is refused; existing sessions are NOT revoked"
      : "effect   login is permitted again",
  ]);
  if (!ok) return 0;

  await prisma.user.update({ where: { id: user.id }, data: { status } });
  await logEvent({
    category: "user",
    message: `Account ${status === STATUSES.suspended ? "disabled" : "enabled"} via CLI: ${email}`,
    metadata: { userId: user.id, status, source: "scripts/admin-user.js" },
  });
  console.log(`\n${email} is now "${status}".`);
  return 0;
}

async function cmdResetPassword(args) {
  const email = requireEmail(args);
  const user = await findUser(email);
  if (!user) fail(`No account found for ${email}`);

  const { password, generated } = await resolvePassword(args, { required: true });

  const ok = await gate(args, `RESET PASSWORD for ${email}`, [
    `role     ${user.role} (unchanged)`,
    `status   ${user.status} (unchanged)`,
    `password ${user.passwordHash ? "replaced" : "set for the first time"}` +
      (generated ? " — generated, printed once below" : " (hidden)"),
    "effect   existing sessions are NOT revoked",
  ]);
  if (!ok) return 0;

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await logEvent({
    category: "auth",
    message: `Password reset via CLI: ${email}`,
    metadata: { userId: user.id, source: "scripts/admin-user.js" },
  });

  console.log(`\nPassword updated for ${email}.`);
  if (generated) {
    console.log(`\nPassword (shown once, not stored anywhere in plain text):\n\n    ${password}\n`);
  }
  return 0;
}

const USAGE = `
Admin account management.

  node scripts/admin-user.js create         --email <e> --name <n> [--password <p> | --generate] [--role admin|manager|customer]
  node scripts/admin-user.js list           [--admins-only] [--json]
  node scripts/admin-user.js promote        --email <e>
  node scripts/admin-user.js demote         --email <e>
  node scripts/admin-user.js reset-password --email <e> [--password <p> | --generate]
  node scripts/admin-user.js disable        --email <e>
  node scripts/admin-user.js enable         --email <e>

Options:
  --yes        skip the confirmation prompt
  --dry-run    validate and print the intended change, write nothing
  --generate   generate a strong password, printed once to stdout
  --json       machine-readable output (list only)

Password may also come from ADMIN_USER_PASSWORD. With none of --password,
--generate or that variable, you are prompted with hidden input.
`;

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  if (!command || args.help || command === "help") { console.log(USAGE); return command ? 0 : 1; }
  if (args["dry-run"]) console.log("DRY RUN — no changes will be written.");

  switch (command) {
    case "create":         return cmdCreate(args);
    case "list":           return cmdList(args);
    case "promote":        return setRole(args, "admin", "promote");
    case "demote":         return setRole(args, "customer", "demote");
    case "reset-password": return cmdResetPassword(args);
    case "disable":        return setStatus(args, STATUSES.suspended, "disable");
    case "enable":         return setStatus(args, STATUSES.active, "enable");
    default:
      process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
      return 1;
  }
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code || 0); })
  .catch(async (err) => {
    // Plain language on stderr; the stack only when something genuinely
    // unexpected happened rather than a validation failure.
    await prisma.$disconnect().catch(() => {});
    process.stderr.write(`\n${err && err.message ? err.message : String(err)}\n`);
    if (process.env.DEBUG) process.stderr.write(String(err && err.stack) + "\n");
    process.exit(1);
  });
