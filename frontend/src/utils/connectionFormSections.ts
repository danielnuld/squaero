// How the connection form is laid out (issue #531): which section each field
// belongs to, and how complete each section is.
//
// The form used to split fields into TABS built from `DriverField.group`, which
// is what hid the SSH tunnel: nothing said it existed, and it turns itself on by
// typing into a field of a tab nobody opened. Sections are the same data read in
// the order of the task — where is it, who am I, how is it protected, how do I
// reach it, what do I call it — all on one page.
//
// Pure: no locale, no DOM. Labels and hints are returned as i18n KEYS.

import type { Connection, DriverField, DriverSchema, FieldErrors } from "./connections";

export type SectionId = "server" | "file" | "auth" | "security" | "ssh";

export interface FormSection {
  id: SectionId;
  fields: DriverField[];
}

/**
 * Where each known field goes.
 *
 * Explicit rather than a `section` property on DriverField: adding one would
 * touch all six schemas and oblige every future driver to know about the form.
 * A key missing here is not a crash — it falls back to "server", so a new
 * driver's field is always visible somewhere — and a unit test walks
 * DRIVER_SCHEMAS to make sure none is actually missing.
 */
const FIELD_SECTION: Record<string, SectionId> = {
  // SQLite is a file, not a server.
  path: "file",

  host: "server",
  port: "server",
  instance: "server", // SQL Server named instance

  user: "auth",
  password: "auth",
  database: "auth",
  auth_source: "auth", // MongoDB

  // Each engine spells its transport security differently; they all mean "how
  // is this protected", so they share a section.
  ssl_mode: "security", // MySQL
  ssl_ca: "security",
  ssl_cert: "security",
  ssl_key: "security",
  sslmode: "security", // PostgreSQL (libpq's own spelling)
  sslrootcert: "security",
  sslcert: "security",
  sslkey: "security",
  tls: "security", // MongoDB, Informix
  tls_ca: "security", // Informix
  encryption: "security", // SQL Server

  ssh_host: "ssh",
  ssh_port: "ssh",
  ssh_user: "ssh",
  ssh_auth: "ssh",
  ssh_password: "ssh",
  ssh_key: "ssh",
  ssh_key_passphrase: "ssh",
  ssh_target_host: "ssh",
  ssh_target_port: "ssh",
  ssh_host_key_policy: "ssh",
  ssh_known_hosts: "ssh",
};

/** Where a field with no entry in the map lands. */
export const FALLBACK_SECTION: SectionId = "server";

/** The section a field key belongs to. */
export function sectionOf(key: string): SectionId {
  return FIELD_SECTION[key] ?? FALLBACK_SECTION;
}

/**
 * Whether the key is mapped on purpose rather than falling back.
 *
 * Only the guard test uses this: a field that lands in "server" by accident
 * looks identical to one placed there deliberately, so asserting the section
 * would pass for a field nobody has thought about.
 */
export function isKnownField(key: string): boolean {
  return key in FIELD_SECTION;
}

/** Fixed order, so every engine's form reads the same way. */
const SECTION_ORDER: readonly SectionId[] = ["server", "file", "auth", "security", "ssh"];

/**
 * The schema's fields grouped into sections, in the fixed order. Empty sections
 * are dropped: SQLite has no server and no tunnel, and saying so with an empty
 * heading would be worse than not saying it.
 */
export function formSections(schema: DriverSchema): FormSection[] {
  const byId = new Map<SectionId, DriverField[]>();
  for (const field of schema.fields) {
    const id = sectionOf(field.key);
    const list = byId.get(id);
    if (list) list.push(field);
    else byId.set(id, [field]);
  }
  return SECTION_ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    fields: byId.get(id)!,
  }));
}

/**
 * Fields that belong on one line, because they are one idea: an address is a
 * host AND a port, and credentials are a user AND a password. Stacking them
 * turns a four-field form into a column twice as tall as it needs to be.
 */
const PAIRED_WITH: Record<string, string> = { host: "port", user: "password" };

/**
 * A section's fields grouped into rows of one or two.
 *
 * Pairs only when BOTH halves are actually in the schema, so an engine that
 * drops one of them (a port-less driver) gets a single full-width field rather
 * than a half-width one with a hole beside it.
 */
export function fieldRows(fields: DriverField[]): DriverField[][] {
  const rows: DriverField[][] = [];
  const used = new Set<string>();
  for (const field of fields) {
    if (used.has(field.key)) continue;
    const mateKey = PAIRED_WITH[field.key];
    const mate = mateKey ? fields.find((f) => f.key === mateKey) : undefined;
    if (mate) {
      used.add(mate.key);
      rows.push([field, mate]);
    } else {
      rows.push([field]);
    }
  }
  return rows;
}

export type SectionStatus = "ok" | "error" | "off" | "pending";

/**
 * What the side index shows next to a section.
 *
 * `error` only once the user has tried to save or test: marking a form red
 * before it has been submitted is how a brand-new form greets you with three
 * complaints about fields you have not reached yet. Until then an invalid or
 * unfinished section is `pending` — something still to do, not something wrong.
 */
export function sectionStatus(
  section: FormSection,
  conn: Connection,
  errors: FieldErrors,
  opts: { tried: boolean; sshOn: boolean },
): SectionStatus {
  if (section.id === "ssh" && !opts.sshOn) return "off";
  if (section.fields.some((f) => errors.params[f.key])) {
    return opts.tried ? "error" : "pending";
  }
  const missing = section.fields.some(
    (f) => f.required && (conn.params[f.key] ?? "").trim() === "",
  );
  return missing ? "pending" : "ok";
}

/**
 * The sentence under a security control, as an i18n key.
 *
 * Keyed by VALUE, because the values are distinct across engines ("required" is
 * MySQL's, "require" is PostgreSQL's). The empty value means "whatever the
 * client library defaults to", which differs per engine, so that one is keyed by
 * the FIELD instead. Anything unknown falls back to the field's default line, so
 * a value added to a schema can never leave a blank gap.
 */
const DEFAULT_HINT: Record<string, string> = {
  ssl_mode: "cform.sec.mysqlDefault",
  sslmode: "cform.sec.pgDefault",
  tls: "cform.sec.tlsOff",
  encryption: "cform.sec.encDefault",
};

const VALUE_HINT: Record<string, string> = {
  disabled: "cform.sec.none",
  disable: "cform.sec.none",
  off: "cform.sec.none",
  allow: "cform.sec.allow",
  prefer: "cform.sec.prefer",
  required: "cform.sec.encrypted",
  require: "cform.sec.encrypted",
  request: "cform.sec.encrypted",
  true: "cform.sec.encrypted",
  strict: "cform.sec.strict",
  verify_ca: "cform.sec.verifyCa",
  "verify-ca": "cform.sec.verifyCa",
  verify_identity: "cform.sec.verifyIdentity",
  "verify-full": "cform.sec.verifyIdentity",
};

/** i18n key explaining what a security value actually protects. */
export function securityHint(fieldKey: string, value: string): string {
  const fallback = DEFAULT_HINT[fieldKey] ?? "cform.sec.none";
  if (value === "") return fallback;
  return VALUE_HINT[value] ?? fallback;
}

/**
 * Values that verify the server's certificate, and so need the certificate
 * fields on screen: MySQL, PostgreSQL and Informix (its CA file). SQL Server's
 * db-lib takes no CA file at all — showing empty certificate boxes there would
 * promise a check the driver cannot make.
 */
const CERT_MODES = new Set(["verify_ca", "verify_identity", "verify-ca", "verify-full"]);

/** True when this security value needs the CA/cert/key fields shown. */
export function needsCertificates(value: string): boolean {
  return CERT_MODES.has(value);
}
