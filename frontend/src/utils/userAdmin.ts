// Pure per-engine SQL for user/role management (issue #140): list users, view a
// user's privileges, and build GRANT / REVOKE statements from a form — all
// client-side via query.run, no core change. Scope is per engine and honest where
// it does not apply: MySQL/MariaDB are fully supported here; SQLite has no users,
// and Informix / PostgreSQL / MongoDB user administration is out of scope for now
// (their GRANT dialects and user catalogs differ enough to warrant their own pass).
// All pure and unit-tested; the component just runs the SQL these return.

import { engineFamily as family } from "./engineFamily";
import { t } from "./i18n";
import { quoteIdentifier } from "./schema";

/** What user administration is available for an engine. */
export interface UserAdminSupport {
  supported: boolean;
  /** SQL listing the users (null when unsupported). */
  listUsersSql: string | null;
  /** Result column holding the user name. */
  userNameCol: string | null;
  /** Result column holding the host part, or null when the engine has none. */
  userHostCol: string | null;
  /** Result column flagging a superuser ('Y'/'N'), or null when the engine has none. */
  userSuperCol: string | null;
  /** Result column flagging who can grant privileges ('Y'/'N'), or null. */
  userGrantCol: string | null;
}

/** One row of the user list. */
export interface UserRow {
  name: string;
  host: string;
  /** Holds the SUPER privilege (`Super_priv = 'Y'`). */
  superuser: boolean;
  /** Can grant privileges to others (`Grant_priv = 'Y'`). */
  grantOption: boolean;
}

/** The panel's search box plus its two quick filters. */
export interface UserFilter {
  query: string;
  onlySuper: boolean;
  hideSystem: boolean;
}

/** Options for a GRANT/REVOKE statement built from the form. */
export interface GrantOptions {
  privileges: string[];
  /** e.g. "*.*", "mydb.*", "mydb.mytable". */
  scope: string;
  user: string;
  host?: string;
  /** Column-level grant: the privileges apply to these columns only. */
  columns?: string[];
}

/** Options for creating a new user. */
export interface NewUserOptions {
  user: string;
  host?: string;
  /** Optional password; when blank the user is created without one. */
  password?: string;
}

/** The privileges offered in the MySQL/MariaDB grant form. */
export const MYSQL_PRIVILEGES = [
  "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX",
  "REFERENCES", "CREATE VIEW", "SHOW VIEW", "TRIGGER", "EXECUTE", "GRANT OPTION",
  "ALL PRIVILEGES",
];

/**
 * What a grant applies to (issue #657): the whole server, one database, one
 * table, or a hand-typed ON target for what the pickers cannot express (a
 * wildcard such as `app\_%`.*).
 */
export type GrantTarget =
  | { level: "server" }
  | { level: "database"; db: string }
  | { level: "table"; db: string; table: string }
  | { level: "column"; db: string; table: string; columns: string[] }
  | { level: "custom"; text: string };

export type GrantLevel = GrantTarget["level"];

/**
 * The ON clause for a target, names quoted as identifiers; null while the
 * target is incomplete (no database or table picked, blank custom text), so the
 * form shows no statement rather than a wrong one.
 */
export function grantScope(target: GrantTarget): string | null {
  const id = (name: string) => quoteIdentifier(name, "mysql");
  switch (target.level) {
    case "server":
      return "*.*";
    case "database":
      return target.db ? `${id(target.db)}.*` : null;
    case "table":
      return target.db && target.table ? `${id(target.db)}.${id(target.table)}` : null;
    case "column":
      return target.db && target.table && target.columns.length > 0
        ? `${id(target.db)}.${id(target.table)}`
        : null;
    case "custom":
      return target.text.trim() || null;
  }
}

/**
 * The privileges the form offers at a level. EXECUTE is a routine privilege
 * that MySQL rejects ON a table; every other one in the list is valid at all
 * levels. A custom target is not inspected, so it keeps the full list.
 */
export function privilegesFor(level: GrantLevel): string[] {
  // MySQL grants only these four per column.
  if (level === "column") return ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
  return level === "table" ? MYSQL_PRIVILEGES.filter((p) => p !== "EXECUTE") : MYSQL_PRIVILEGES;
}

/** User-administration capabilities for an engine. */
export function userAdminFor(engine: string): UserAdminSupport {
  if (family(engine) === "mysql") {
    return {
      supported: true,
      // Super_priv / Grant_priv come from the same catalog row the list already
      // reads, so the privilege markers cost no extra round trip. Superusers
      // sort first ('Y' > 'N' descending): that is the order the list is read in
      // when auditing who can do what.
      listUsersSql:
        "SELECT User, Host, Super_priv, Grant_priv FROM mysql.user " +
        "ORDER BY Super_priv DESC, User, Host",
      userNameCol: "User",
      userHostCol: "Host",
      userSuperCol: "Super_priv",
      userGrantCol: "Grant_priv",
    };
  }
  return {
    supported: false,
    listUsersSql: null,
    userNameCol: null,
    userHostCol: null,
    userSuperCol: null,
    userGrantCol: null,
  };
}

/**
 * Read the user list result into rows. A missing name column yields no rows; a
 * missing privilege column just leaves the flag false, so an engine (or a
 * cut-down catalog) that does not expose it degrades to "no badge" rather than
 * claiming something untrue.
 */
export function parseUserRows(
  result: { columns: { name: string }[]; rows: (string | null)[][] },
  support: UserAdminSupport,
): UserRow[] {
  const idx = (col: string | null) =>
    col === null ? -1 : result.columns.findIndex((c) => c.name === col);
  const ni = idx(support.userNameCol);
  if (ni === -1) return [];
  const hi = idx(support.userHostCol);
  const si = idx(support.userSuperCol);
  const gi = idx(support.userGrantCol);
  const yes = (row: (string | null)[], i: number) =>
    i >= 0 && (row[i] ?? "").trim().toUpperCase() === "Y";
  return result.rows
    .map((r) => ({
      name: r[ni] ?? "",
      host: hi >= 0 ? (r[hi] ?? "") : "",
      superuser: yes(r, si),
      grantOption: yes(r, gi),
    }))
    .filter((u) => u.name);
}

/**
 * The engine's own internal accounts (`mysql.sys`, `mysql.session`,
 * `mariadb.sys`…). They are never logged into by a person, so the panel can hide
 * them; matched by prefix because that is how both servers name them.
 */
export function isSystemUser(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("mysql.") || n.startsWith("mariadb.");
}

/**
 * Filter the loaded user list: the query matches `user@host` (the same account
 * exists once per host in MySQL, so the host has to be searchable), and the two
 * quick filters narrow it further. A blank query matches everything.
 */
export function searchUsers(list: UserRow[], filter: UserFilter): UserRow[] {
  const q = filter.query.trim().toLowerCase();
  return list.filter((u) => {
    if (filter.onlySuper && !u.superuser) return false;
    if (filter.hideSystem && isSystemUser(u.name)) return false;
    return q === "" || `${u.name}@${u.host}`.toLowerCase().includes(q);
  });
}

/**
 * Escape a value for a single-quoted SQL string literal. Backslashes are escaped
 * first (MySQL's default sql_mode treats `\` as an escape char, so a trailing `\`
 * would otherwise swallow the closing quote and shift the string boundary), then
 * embedded single quotes are doubled. This is the trust boundary every builder in
 * this file relies on, including user-supplied passwords.
 */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/** SQL showing a user's granted privileges, or null when unsupported. */
export function showGrantsSql(engine: string, user: string, host = "%"): string | null {
  if (family(engine) !== "mysql" || !user) return null;
  return `SHOW GRANTS FOR '${q(user)}'@'${q(host)}'`;
}

/** Normalize the privilege list: ALL PRIVILEGES collapses to itself alone.
    With columns, each privilege names them: SELECT (`a`, `b`). */
function privilegeList(privileges: string[], columns: string[] = []): string | null {
  const cleaned = privileges.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) return null;
  if (columns.length > 0) {
    const cols = columns.map((c) => quoteIdentifier(c, "mysql")).join(", ");
    return cleaned.map((p) => `${p} (${cols})`).join(", ");
  }
  if (cleaned.some((p) => p.toUpperCase() === "ALL PRIVILEGES")) return "ALL PRIVILEGES";
  return cleaned.join(", ");
}

/** Build a GRANT statement, or null when the engine is unsupported or the form is
    incomplete (no privileges, scope, or user). */
export function buildGrantSql(engine: string, opts: GrantOptions): string | null {
  if (family(engine) !== "mysql") return null;
  const privs = privilegeList(opts.privileges, opts.columns);
  if (!privs || !opts.scope.trim() || !opts.user.trim()) return null;
  return `GRANT ${privs} ON ${opts.scope.trim()} TO '${q(opts.user.trim())}'@'${q((opts.host ?? "%").trim())}'`;
}

/** Build a REVOKE statement, or null (same rules as buildGrantSql). */
export function buildRevokeSql(engine: string, opts: GrantOptions): string | null {
  if (family(engine) !== "mysql") return null;
  const privs = privilegeList(opts.privileges, opts.columns);
  if (!privs || !opts.scope.trim() || !opts.user.trim()) return null;
  return `REVOKE ${privs} ON ${opts.scope.trim()} FROM '${q(opts.user.trim())}'@'${q((opts.host ?? "%").trim())}'`;
}

/**
 * Build a CREATE USER statement, or null when the engine is unsupported or no
 * user name was given. A blank password creates the user without one (the caller
 * decides whether that is acceptable). user/host/password are single-quote
 * escaped.
 */
export function buildCreateUserSql(engine: string, opts: NewUserOptions): string | null {
  if (family(engine) !== "mysql") return null;
  const user = opts.user.trim();
  if (!user) return null;
  const host = (opts.host ?? "%").trim() || "%";
  const base = `CREATE USER '${q(user)}'@'${q(host)}'`;
  const pw = (opts.password ?? "").length > 0;
  return pw ? `${base} IDENTIFIED BY '${q(opts.password!)}'` : base;
}

/** Build a DROP USER statement, or null (unsupported engine / no user name). */
export function buildDropUserSql(engine: string, user: string, host = "%"): string | null {
  if (family(engine) !== "mysql") return null;
  const u = user.trim();
  if (!u) return null;
  const h = (host ?? "%").trim() || "%";
  return `DROP USER '${q(u)}'@'${q(h)}'`;
}

/** A short reason the feature is unavailable on an engine. */
export function unsupportedReason(engine: string): string {
  const f = family(engine);
  if (f === "sqlite") return t("users.unsupported.sqlite");
  if (f === "informix") return t("users.unsupported.informix");
  if (f === "postgres") return t("users.unsupported.postgres");
  if (f === "mongodb") return t("users.unsupported.mongodb");
  return t("users.unsupported.other", { engine: engine || t("engine.unknown") });
}

/** ALTER USER … IDENTIFIED BY: a new password, or null (unsupported / blank). */
export function buildSetPasswordSql(engine: string, user: string, host: string, password: string): string | null {
  if (family(engine) !== "mysql" || !user.trim() || password.length === 0) return null;
  return `ALTER USER '${q(user.trim())}'@'${q(host.trim() || "%")}' IDENTIFIED BY '${q(password)}'`;
}

/** ALTER USER … ACCOUNT LOCK / UNLOCK (MySQL 5.7.6+, MariaDB 10.4.2+; an older
    server refuses it and the panel shows its words). */
export function buildLockUserSql(engine: string, user: string, host: string, lock: boolean): string | null {
  if (family(engine) !== "mysql" || !user.trim()) return null;
  return `ALTER USER '${q(user.trim())}'@'${q(host.trim() || "%")}' ACCOUNT ${lock ? "LOCK" : "UNLOCK"}`;
}

/** One privilege of a readable grant, with the columns it is limited to. */
export interface GrantPrivilege {
  name: string;
  columns: string[];
}

/** A SHOW GRANTS line read into scope → privileges (P6: readable grants). */
export interface ReadableGrant {
  /** What it applies to, unquoted: `*.*`, `ventas.*`, `ventas.pedidos`,
      `PROCEDURE ventas.p`; null for a role grant. */
  scope: string | null;
  level: "server" | "database" | "object" | "role";
  privileges: GrantPrivilege[];
  grantOption: boolean;
}

/** Split on commas outside parentheses and quotes. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "`" || ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const unquote = (s: string) => s.replace(/[`'"]/g, "");

/**
 * Read one line of SHOW GRANTS (MySQL/MariaDB) into what it grants and where:
 * «GRANT SELECT (`id`), UPDATE ON `ventas`.`pedidos` TO …» → scope
 * `ventas.pedidos`, SELECT on (id), UPDATE. Role grants («GRANT `r`@`%` TO …»)
 * list the roles. Null when the line is not a GRANT it can read; the panel then
 * shows it as written.
 */
export function parseGrant(line: string): ReadableGrant | null {
  const text = line.trim().replace(/;$/, "");
  const grantOption = /\sWITH\s+GRANT\s+OPTION\b/i.test(text);
  const on = /^GRANT\s+([\s\S]+?)\s+ON\s+([\s\S]+?)\s+TO\s+/i.exec(text);
  if (on) {
    const scope = unquote(on[2].trim());
    const privileges = splitTop(on[1]).map((p) => {
      const m = /^([^(]+?)\s*\(([^)]*)\)$/.exec(p);
      return m
        ? { name: m[1].trim().toUpperCase(), columns: m[2].split(",").map((c) => unquote(c.trim())).filter(Boolean) }
        : { name: p.trim().toUpperCase(), columns: [] };
    });
    const level = scope === "*.*" ? "server" : /^[^.\s]+\.\*$/.test(scope) ? "database" : "object";
    return { scope, level, privileges, grantOption };
  }
  const role = /^GRANT\s+([\s\S]+?)\s+TO\s+/i.exec(text);
  if (role) {
    return {
      scope: null,
      level: "role",
      privileges: splitTop(role[1]).map((r) => ({ name: unquote(r), columns: [] })),
      grantOption: false,
    };
  }
  return null;
}
