// Pure per-engine SQL for user/role management (issue #140): list users, view a
// user's privileges, and build GRANT / REVOKE statements from a form — all
// client-side via query.run, no core change. Scope is per engine and honest where
// it does not apply: MySQL/MariaDB are fully supported here; SQLite has no users,
// and Informix / PostgreSQL / MongoDB user administration is out of scope for now
// (their GRANT dialects and user catalogs differ enough to warrant their own pass).
// All pure and unit-tested; the component just runs the SQL these return.

import { engineFamily as family } from "./engineFamily";

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

/** Normalize the privilege list: ALL PRIVILEGES collapses to itself alone. */
function privilegeList(privileges: string[]): string | null {
  const cleaned = privileges.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) return null;
  if (cleaned.some((p) => p.toUpperCase() === "ALL PRIVILEGES")) return "ALL PRIVILEGES";
  return cleaned.join(", ");
}

/** Build a GRANT statement, or null when the engine is unsupported or the form is
    incomplete (no privileges, scope, or user). */
export function buildGrantSql(engine: string, opts: GrantOptions): string | null {
  if (family(engine) !== "mysql") return null;
  const privs = privilegeList(opts.privileges);
  if (!privs || !opts.scope.trim() || !opts.user.trim()) return null;
  return `GRANT ${privs} ON ${opts.scope.trim()} TO '${q(opts.user.trim())}'@'${q((opts.host ?? "%").trim())}'`;
}

/** Build a REVOKE statement, or null (same rules as buildGrantSql). */
export function buildRevokeSql(engine: string, opts: GrantOptions): string | null {
  if (family(engine) !== "mysql") return null;
  const privs = privilegeList(opts.privileges);
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
  if (f === "sqlite") return "SQLite no tiene usuarios ni permisos: es una base de datos embebida.";
  if (f === "informix") return "La gestión de usuarios de Informix aún no está disponible aquí.";
  if (f === "postgres")
    return "La gestión de usuarios de PostgreSQL aún no está disponible aquí.";
  if (f === "mongodb") return "La gestión de usuarios de MongoDB aún no está disponible aquí.";
  return `La gestión de usuarios no está disponible para el motor "${engine || "desconocido"}".`;
}
