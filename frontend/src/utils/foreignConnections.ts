// Reading connection lists exported by OTHER database tools, so moving to Squaero
// does not start with retyping thirty servers by hand. Two formats:
//
//   - DBeaver's `data-sources.json` (the workspace file, or the one its
//     "Export connections" produces), optionally paired with the
//     `credentials-config.json` that sits beside it.
//   - Navicat's `.ncx` export (XML), which carries its passwords inline.
//
// What is imported is the whole connection: engine, host, port, database, user,
// the SSH tunnel when there is one, and the password when the file has one this
// can read (see foreignSecrets.ts for what "can read" means and why it is
// allowed to). A password that cannot be read is reported, never guessed.
//
// Both parsers are deliberately tolerant. These are other people's formats,
// they differ across versions, and a strict reader that drops a connection
// because a version called a field `server` instead of `host` is worse than a
// loose one that gets it right: every logical field is looked up through a list
// of aliases, case-insensitively.

import type { Connection } from "./connections";
import { navicatPassword, type ForeignCredential } from "./foreignSecrets";

export type ForeignSource = "dbeaver" | "navicat";

/** An entry that was recognised but cannot be imported, and why. */
export interface SkippedConnection {
  name: string;
  reason: string;
}

export interface ForeignImport {
  source: ForeignSource;
  /** Ready to merge: no id of ours (the merge assigns one). */
  connections: Connection[];
  /**
   * The foreign id of each connection, in the same order. DBeaver keys its
   * credentials file by it, which is the only way to pair the two files.
   */
  ids: string[];
  skipped: SkippedConnection[];
  /** How many passwords were there but could not be read. */
  locked: number;
}

/**
 * Which tool wrote this file, or null when it is neither.
 *
 * Sniffed from the content, not the extension: DBeaver's file is `.json` like
 * Squaero's own, and people rename things.
 */
export function detectForeign(raw: string): ForeignSource | null {
  const head = raw.slice(0, 4096);
  if (/<\s*Connections\b/i.test(head) || /<\s*Connection\b/i.test(head)) return "navicat";
  if (/"connections"\s*:/.test(head) && /"(provider|configuration)"\s*:/.test(raw)) {
    return "dbeaver";
  }
  return null;
}

/** Case-insensitive lookup of the first alias present and non-empty. */
function pick(src: Record<string, unknown>, aliases: string[]): string {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(src)) lower.set(k.toLowerCase(), v);
  for (const alias of aliases) {
    const v = lower.get(alias.toLowerCase());
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return v ? "true" : "";
  }
  return "";
}

/** Only set a param when there is something to set: blank ≠ "not configured". */
function put(params: Record<string, string>, key: string, value: string): void {
  if (value !== "") params[key] = value;
}

/**
 * The engines Squaero ships, keyed by every name the two tools use for them.
 *
 * An engine that is missing here is not a bug to paper over: the import reports
 * it as skipped and says which engine it was, because a connection silently
 * turned into the wrong driver would fail at connect time with a message about
 * something else entirely.
 */
const ENGINES: Record<string, string> = {
  // DBeaver providers / driver ids
  postgresql: "postgres",
  postgres: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  mongodb: "mongodb",
  mongo: "mongodb",
  informix: "informix",
  // Navicat ConnType spellings
  mysqlconn: "mysql",
  postgresqlconn: "postgres",
  mariadbconn: "mysql",
  sqliteconn: "sqlite",
  mongodbconn: "mongodb",
};

/** The Squaero driver for a foreign engine name, or "" when we do not ship it. */
export function driverFor(engine: string): string {
  return ENGINES[engine.trim().toLowerCase().replace(/[\s_-]/g, "")] ?? "";
}

/** The SSH tunnel half, shared by both readers (same field names on our side). */
function sshParams(
  params: Record<string, string>,
  host: string,
  port: string,
  user: string,
): void {
  if (host === "") return;
  put(params, "ssh_host", host);
  put(params, "ssh_port", port);
  put(params, "ssh_user", user);
  // Not the auth method: DBeaver and Navicat both point at a key file or a
  // saved password we cannot read, and guessing "agent" would send someone to a
  // failing connect. Left blank, which is our own "ask me" default.
}

/**
 * DBeaver's `data-sources.json`.
 *
 * `connections` is an object keyed by DBeaver's internal id; each entry carries a
 * `provider` (the engine), a display `name`, an optional `folder`, and a
 * `configuration` with the address. The user name lives in `configuration.user`
 * in the versions that keep it there, and in the encrypted credentials file in
 * the ones that do not — hence the alias list and the blank when it is absent.
 */
export function parseDbeaver(raw: string): ForeignImport | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "El archivo de DBeaver no es JSON válido." };
  }
  const conns = (data as { connections?: unknown } | null)?.connections;
  if (!conns || typeof conns !== "object" || Array.isArray(conns)) {
    return { error: "El archivo de DBeaver no contiene conexiones." };
  }

  const out: Connection[] = [];
  const ids: string[] = [];
  const skipped: SkippedConnection[] = [];

  for (const [foreignId, entry] of Object.entries(conns as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const cfg = (e.configuration && typeof e.configuration === "object"
      ? (e.configuration as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    const name = pick(e, ["name"]) || pick(cfg, ["database", "host"]);
    if (name === "") continue;

    const engine = pick(e, ["provider", "driver"]);
    const driver = driverFor(engine);
    if (driver === "") {
      skipped.push({ name, reason: engine || "motor desconocido" });
      continue;
    }

    const params: Record<string, string> = {};
    if (driver === "sqlite") {
      put(params, "path", pick(cfg, ["database", "url", "path", "file"]));
    } else {
      put(params, "host", pick(cfg, ["host", "server"]));
      put(params, "port", pick(cfg, ["port"]));
      put(params, "database", pick(cfg, ["database"]));
      put(params, "user", pick(cfg, ["user", "userName", "username"]));
      // Some versions leave the password right here in the clear; the rest keep
      // it in credentials-config.json, which applyCredentials() fills in later.
      put(params, "password", pick(cfg, ["password"]));
      if (driver === "informix") put(params, "server", pick(cfg, ["server", "serverName"]));
    }

    // DBeaver nests the tunnel under handlers/network-handlers in some versions
    // and flat in others; both are read the same way.
    const handler = (cfg.handlers ?? cfg["network-handlers"]) as unknown;
    const ssh = Array.isArray(handler)
      ? ((handler.find(
          (h) => typeof h === "object" && /ssh/i.test(String((h as { id?: string }).id ?? "")),
        ) ?? {}) as Record<string, unknown>)
      : handler && typeof handler === "object"
        ? ((Object.entries(handler as Record<string, unknown>).find(([k]) => /ssh/i.test(k))?.[1] ??
            {}) as Record<string, unknown>)
        : {};
    const sshProps = (ssh.properties && typeof ssh.properties === "object"
      ? (ssh.properties as Record<string, unknown>)
      : ssh) as Record<string, unknown>;
    sshParams(
      params,
      pick(sshProps, ["host", "hostName", "sshHost"]),
      pick(sshProps, ["port", "sshPort"]),
      pick(sshProps, ["user", "userName", "sshUser"]),
    );

    out.push({
      id: "",
      name,
      driver,
      params,
      ...(pick(e, ["folder"]) ? { group: pick(e, ["folder"]) } : {}),
    });
    ids.push(foreignId);
  }

  return { source: "dbeaver", connections: out, ids, skipped, locked: 0 };
}

/**
 * Fills in what `credentials-config.json` holds, matched by DBeaver's own id.
 *
 * Returns how many connections still have a password stored over there that
 * this could not read — an empty map because the file was not given, or because
 * the key no longer opens it. Zero is the only number worth not mentioning.
 */
export function applyCredentials(
  imported: ForeignImport,
  creds: Record<string, ForeignCredential>,
): ForeignImport {
  if (Object.keys(creds).length === 0) return imported;
  const connections = imported.connections.map((c, i) => {
    const cred = creds[imported.ids[i]];
    if (!cred) return c;
    const params = { ...c.params };
    if (cred.user && !params.user) params.user = cred.user;
    if (cred.password) params.password = cred.password;
    return { ...c, params };
  });
  return { ...imported, connections };
}

/**
 * Navicat's `.ncx` export (XML).
 *
 * One `<Connection>` element per server, everything in attributes. Attribute
 * spellings drift between Navicat versions and between engines — the database
 * is `Database` here and `DatabaseFileName` there — so every field goes through
 * the alias list.
 */
export async function parseNavicat(raw: string): Promise<ForeignImport | { error: string }> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(raw, "application/xml");
  } catch {
    return { error: "El archivo de Navicat no es XML válido." };
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { error: "El archivo de Navicat no es XML válido." };
  }

  const nodes = Array.from(doc.getElementsByTagName("*")).filter(
    (el) => el.tagName.toLowerCase() === "connection",
  );
  if (nodes.length === 0) {
    return { error: "El archivo de Navicat no contiene conexiones." };
  }

  const out: Connection[] = [];
  const skipped: SkippedConnection[] = [];
  let locked = 0;

  for (const el of nodes) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;

    const name = pick(attrs, ["ConnectionName", "Name"]);
    if (name === "") continue;

    const engine = pick(attrs, ["ConnType", "ConnectionType", "Type"]);
    const driver = driverFor(engine);
    if (driver === "") {
      skipped.push({ name, reason: engine || "motor desconocido" });
      continue;
    }

    const params: Record<string, string> = {};
    if (driver === "sqlite") {
      put(params, "path", pick(attrs, ["DatabaseFileName", "DatabaseName", "FileName", "Database"]));
    } else {
      put(params, "host", pick(attrs, ["Host", "HostName", "Server"]));
      put(params, "port", pick(attrs, ["Port"]));
      put(params, "database", pick(attrs, ["Database", "DatabaseName", "DefaultDatabase", "InitialDatabase"]));
      put(params, "user", pick(attrs, ["UserName", "User"]));
      // Navicat 12+ hex-encodes the password with the key that ships in libcc;
      // an older file decrypts to bytes that are not text, and is counted rather
      // than stored as somebody's password.
      const stored = pick(attrs, ["Password", "Pwd"]);
      if (stored !== "") {
        const clear = await navicatPassword(stored);
        if (clear === null) locked += 1;
        else put(params, "password", clear);
      }
    }

    sshParams(
      params,
      pick(attrs, ["SSH_Host", "SSHHost", "SSH_HostName"]),
      pick(attrs, ["SSH_Port", "SSHPort"]),
      pick(attrs, ["SSH_UserName", "SSHUserName", "SSH_User"]),
    );

    out.push({ id: "", name, driver, params });
  }

  // Navicat has no id of its own in the export; the name is what it goes by.
  return {
    source: "navicat",
    connections: out,
    ids: out.map((c) => c.name),
    skipped,
    locked,
  };
}

/** Parse whichever of the two formats this is. */
export function parseForeign(
  raw: string,
  source: ForeignSource,
): Promise<ForeignImport | { error: string }> {
  return source === "dbeaver" ? Promise.resolve(parseDbeaver(raw)) : parseNavicat(raw);
}
