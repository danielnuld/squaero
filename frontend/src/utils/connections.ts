// Connection model and pure helpers for the connection manager (issue #16).
// Connection definitions are UI/config state, persisted client-side; the core
// has no conn.save/list (it only opens/closes active connections), so this is
// the source of truth for saved connections. Secrets (passwords) are never
// written to storage — they are entered at connect time.
//
// Forms are data-driven: each driver declares its DSN fields, so a new engine
// only adds a schema entry. The dsn object built here is what conn.open expects
// (see docs/IPC.md).

export type FieldType = "text" | "number" | "password" | "file" | "select";

export interface FieldOption {
  value: string;
  label: string;
}

export interface DriverField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  /** Choices for a `select` field. */
  options?: FieldOption[];
  /** Optional grouping label; consecutive fields sharing a group render under
      one subheading in the form (used for the optional SSH-tunnel section). */
  group?: string;
}

export interface DriverSchema {
  /** Must match the driver `name` registered in the core. */
  driver: string;
  label: string;
  fields: DriverField[];
}

export interface Connection {
  id: string;
  name: string;
  driver: string;
  /** DSN field values keyed by DriverField.key. */
  params: Record<string, string>;
  /** Optional accent color (a CONNECTION_COLORS hex) to tell connections apart
      at a glance — e.g. production red vs development green. */
  color?: string;
}

/** Curated accent palette for connections (config + sidebar). Chosen to stay
    legible on both themes; the first, red, reads as a "careful — production"
    marker. Empty string means "no color". */
export const CONNECTION_COLORS: string[] = [
  "#e5484d", // red
  "#e5843b", // orange
  "#e0b341", // amber
  "#4bb45e", // green
  "#3ea6b8", // teal
  "#4f7cf0", // blue
  "#9a6ae0", // purple
];

// Optional SSH-tunnel fields, engine-agnostic. The core reads these ssh_* keys
// from the DSN and, when ssh_host is set, opens a local port-forward before the
// driver connects (see docs/IPC.md). Every field is optional: leaving ssh_host
// blank means a direct connection. Append them to any network driver's schema
// with withSshTunnel(); the secret fields (type "password") are stripped from
// storage automatically, like any other secret.
export const SSH_GROUP = "Túnel SSH (opcional)";

export const SSH_TUNNEL_FIELDS: DriverField[] = [
  { key: "ssh_host", label: "Host SSH", type: "text", required: false, placeholder: "bastion.example.com", group: SSH_GROUP },
  { key: "ssh_port", label: "Puerto SSH", type: "number", required: false, placeholder: "22", group: SSH_GROUP },
  { key: "ssh_user", label: "Usuario SSH", type: "text", required: false, group: SSH_GROUP },
  {
    key: "ssh_auth",
    label: "Autenticación SSH",
    type: "select",
    required: false,
    options: [
      { value: "", label: "— (predeterminado: agente)" },
      { value: "agent", label: "Agente SSH" },
      { value: "password", label: "Contraseña" },
      { value: "key", label: "Clave privada" },
    ],
    group: SSH_GROUP,
  },
  { key: "ssh_password", label: "Contraseña SSH", type: "password", required: false, group: SSH_GROUP },
  { key: "ssh_key", label: "Clave privada SSH", type: "file", required: false, placeholder: "~/.ssh/id_ed25519", group: SSH_GROUP },
  { key: "ssh_key_passphrase", label: "Passphrase de la clave", type: "password", required: false, group: SSH_GROUP },
  { key: "ssh_target_host", label: "Host destino (avanzado)", type: "text", required: false, group: SSH_GROUP },
  { key: "ssh_target_port", label: "Puerto destino (avanzado)", type: "number", required: false, group: SSH_GROUP },
  {
    key: "ssh_host_key_policy",
    label: "Clave de host SSH",
    type: "select",
    required: false,
    options: [
      { value: "", label: "— (predeterminado: aceptar y recordar)" },
      { value: "accept-new", label: "Aceptar y recordar (TOFU) — rechaza cambios" },
      { value: "strict", label: "Estricta — solo hosts ya conocidos" },
      { value: "off", label: "Sin verificar (no recomendado)" },
    ],
    group: SSH_GROUP,
  },
  { key: "ssh_known_hosts", label: "Archivo known_hosts (avanzado)", type: "text", required: false, placeholder: "~/.ssh/known_hosts", group: SSH_GROUP },
];

/** Appends the engine-agnostic SSH-tunnel fields to a driver's base fields. */
export function withSshTunnel(base: DriverField[]): DriverField[] {
  return [...base, ...SSH_TUNNEL_FIELDS];
}

// Optional TLS fields for the MySQL/MariaDB driver. The driver wires ssl_mode +
// ssl_ca/ssl_cert/ssl_key into the client before connecting (see docs/IPC.md).
// ssl_mode values are engine-specific (these are MySQL's), so unlike the SSH
// group this is not shared across engines verbatim. All optional: a blank
// ssl_mode leaves the client default.
export const SSL_GROUP = "TLS / SSL (opcional)";

export const MYSQL_SSL_FIELDS: DriverField[] = [
  {
    key: "ssl_mode",
    label: "Modo SSL",
    type: "select",
    required: false,
    options: [
      { value: "", label: "— (predeterminado del cliente)" },
      { value: "disabled", label: "Desactivado" },
      { value: "required", label: "Requerido (cifrado)" },
      { value: "verify_ca", label: "Verificar CA" },
      { value: "verify_identity", label: "Verificar identidad" },
    ],
    group: SSL_GROUP,
  },
  { key: "ssl_ca", label: "Certificado CA", type: "file", required: false, group: SSL_GROUP },
  { key: "ssl_cert", label: "Certificado cliente", type: "file", required: false, group: SSL_GROUP },
  { key: "ssl_key", label: "Clave cliente", type: "file", required: false, group: SSL_GROUP },
];

// Driver form schemas. SQLite is the reference engine shipped in M2; the
// PostgreSQL schema is defined for the data-driven form and lands as a usable
// option when its driver is built (M4). Network engines carry the optional
// SSH-tunnel field group; SQLite (a local file engine) does not.
export const DRIVER_SCHEMAS: Record<string, DriverSchema> = {
  sqlite: {
    driver: "sqlite",
    label: "SQLite",
    fields: [
      {
        key: "path",
        label: "Archivo de base de datos",
        type: "file",
        required: true,
        placeholder: "/ruta/a/base.db  (o :memory:)",
      },
    ],
  },
  postgres: {
    driver: "postgres",
    label: "PostgreSQL",
    fields: withSshTunnel([
      { key: "host", label: "Host", type: "text", required: true, placeholder: "localhost" },
      { key: "port", label: "Puerto", type: "number", required: false, placeholder: "5432" },
      { key: "database", label: "Base de datos", type: "text", required: true },
      { key: "user", label: "Usuario", type: "text", required: true },
      { key: "password", label: "Contraseña", type: "password", required: false },
    ]),
  },
  mysql: {
    driver: "mysql",
    label: "MySQL / MariaDB",
    fields: withSshTunnel([
      { key: "host", label: "Host", type: "text", required: true, placeholder: "127.0.0.1" },
      { key: "port", label: "Puerto", type: "number", required: false, placeholder: "3306" },
      { key: "database", label: "Base de datos", type: "text", required: false },
      { key: "user", label: "Usuario", type: "text", required: true, placeholder: "root" },
      { key: "password", label: "Contraseña", type: "password", required: false },
      ...MYSQL_SSL_FIELDS,
    ]),
  },
  // Informix connects via the ODBC Driver Manager. `port` is a TCP port number
  // OR an /etc/services name, so it is a free-text field; `server` is the
  // INFORMIXSERVER name. The driver maps these to the ODBC connection string
  // (see docs/IPC.md). The CSDK is 32-bit, so this engine is usable in the x86
  // build of the app.
  informix: {
    driver: "informix",
    label: "IBM Informix",
    fields: withSshTunnel([
      { key: "host", label: "Host", type: "text", required: true, placeholder: "127.0.0.1" },
      { key: "port", label: "Puerto / servicio", type: "text", required: true, placeholder: "1526" },
      { key: "server", label: "Servidor (INFORMIXSERVER)", type: "text", required: true, placeholder: "ol_informix1210" },
      { key: "database", label: "Base de datos", type: "text", required: false },
      { key: "user", label: "Usuario", type: "text", required: true, placeholder: "informix" },
      { key: "password", label: "Contraseña", type: "password", required: false },
    ]),
  },
  // MongoDB connects via the mongo-c-driver. Queries use a mongosh-style surface
  // (db.<collection>.find(...)/aggregate(...)); documents are flattened into the
  // tabular grid (see docs/MONGODB.md). `auth_source` is the authentication
  // database (often "admin"); `tls` toggles an encrypted transport. Alternatively
  // a full connection string can be given in a single "uri" field.
  mongodb: {
    driver: "mongodb",
    label: "MongoDB",
    fields: withSshTunnel([
      { key: "host", label: "Host", type: "text", required: true, placeholder: "127.0.0.1" },
      { key: "port", label: "Puerto", type: "number", required: false, placeholder: "27017" },
      { key: "database", label: "Base de datos", type: "text", required: true },
      { key: "user", label: "Usuario", type: "text", required: false },
      { key: "password", label: "Contraseña", type: "password", required: false },
      { key: "auth_source", label: "Base de autenticación", type: "text", required: false, placeholder: "admin" },
      {
        key: "tls",
        label: "TLS",
        type: "select",
        required: false,
        options: [
          { value: "", label: "— (desactivado)" },
          { value: "true", label: "Activado" },
        ],
      },
    ]),
  },
};

// Drivers the UI offers. Only engines whose driver actually ships are listed,
// so the UI never advertises a connection it cannot honor (honest capabilities).
// sqlite ships everywhere; mysql, informix and mongodb ship where their client
// libraries are present (mysql via MariaDB Connector/C, informix via the ODBC
// driver, mongodb via the mongo-c-driver).
export const AVAILABLE_DRIVERS: string[] = ["sqlite", "mysql", "informix", "mongodb"];

/** Schema for a driver name, or undefined when unknown. */
export function driverSchema(driver: string): DriverSchema | undefined {
  return DRIVER_SCHEMAS[driver];
}

/** Keys of secret (password) fields for a driver. */
export function secretFieldKeys(schema: DriverSchema): string[] {
  return schema.fields.filter((f) => f.type === "password").map((f) => f.key);
}

/** Returns a copy of the connection with secret field values removed. */
export function stripSecrets(conn: Connection, schema: DriverSchema): Connection {
  const secrets = new Set(secretFieldKeys(schema));
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(conn.params)) {
    if (!secrets.has(k)) {
      params[k] = v;
    }
  }
  return { ...conn, params };
}

/**
 * Validation errors for a connection (empty array = valid): a name is required,
 * the driver must be known, and every required field must be non-empty.
 */
export function validateConnection(conn: Connection): string[] {
  const errors: string[] = [];
  if (!conn.name.trim()) {
    errors.push("El nombre es obligatorio.");
  }
  const schema = driverSchema(conn.driver);
  if (!schema) {
    errors.push(`Motor desconocido: ${conn.driver}.`);
    return errors;
  }
  for (const field of schema.fields) {
    if (field.required && !(conn.params[field.key] ?? "").trim()) {
      errors.push(`El campo "${field.label}" es obligatorio.`);
    }
  }
  return errors;
}

// A small visual identity per engine for the driver picker and the saved-
// connection list (issue #109). Emoji keep the bundle free of image assets.
const ENGINE_ICON: Record<string, string> = {
  sqlite: "🗄️",
  mysql: "🐬",
  mariadb: "🐬",
  postgres: "🐘",
  postgresql: "🐘",
  informix: "🏛️",
  mongodb: "🍃",
  oracle: "🔶",
  sqlserver: "🟦",
};

/** Emoji marker for an engine, with a neutral fallback. */
export function engineIcon(driver: string): string {
  return ENGINE_ICON[driver?.toLowerCase()] ?? "🛢️";
}

/** Per-field validation errors (issue #109): name + each param field. */
export interface FieldErrors {
  /** Error for the connection name, or null when valid. */
  name: string | null;
  /** Errors keyed by field key (only invalid fields are present). */
  params: Record<string, string>;
}

/**
 * Validate a connection field by field, so the form can show each error next to
 * its input. A required field must be non-empty; a `number` field must hold a
 * numeric value. Pure and unit-tested.
 */
export function fieldErrors(conn: Connection): FieldErrors {
  const result: FieldErrors = { name: null, params: {} };
  if (!conn.name.trim()) {
    result.name = "El nombre es obligatorio.";
  }
  const schema = driverSchema(conn.driver);
  if (!schema) return result;
  for (const field of schema.fields) {
    const value = (conn.params[field.key] ?? "").trim();
    if (field.required && value === "") {
      result.params[field.key] = "Obligatorio.";
    } else if (field.type === "number" && value !== "" && !/^\d+$/.test(value)) {
      result.params[field.key] = "Debe ser un número.";
    }
  }
  return result;
}

/** True when a FieldErrors has no name or field error. */
export function isValid(errors: FieldErrors): boolean {
  return errors.name === null && Object.keys(errors.params).length === 0;
}

/** Builds the dsn object for conn.open from a connection's params. */
export function buildDsn(conn: Connection): Record<string, string> {
  const schema = driverSchema(conn.driver);
  if (!schema) {
    return { ...conn.params };
  }
  const dsn: Record<string, string> = {};
  for (const field of schema.fields) {
    const value = conn.params[field.key];
    if (value !== undefined && value !== "") {
      dsn[field.key] = value;
    }
  }
  return dsn;
}

/** Next connection id of the form "conn-N", unique within `existing`. */
export function nextConnectionId(existing: Connection[]): string {
  const max = existing.reduce((acc, c) => {
    const m = /^conn-(\d+)$/.exec(c.id);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `conn-${max + 1}`;
}

/** Inserts or replaces a connection by id, preserving order on replace. */
export function upsertConnection(list: Connection[], conn: Connection): Connection[] {
  const idx = list.findIndex((c) => c.id === conn.id);
  if (idx === -1) {
    return [...list, conn];
  }
  const next = list.slice();
  next[idx] = conn;
  return next;
}

/** Removes the connection with `id`. */
export function removeConnection(list: Connection[], id: string): Connection[] {
  return list.filter((c) => c.id !== id);
}

/**
 * Serializes connections for storage. Passwords ARE persisted (plaintext), by
 * maintainer decision, so a saved connection reconnects without re-typing them
 * — the convenience matters for daily use on a single-user desktop. `stripSecrets`
 * remains available for callers that want a secret-free copy.
 */
export function serializeConnections(list: Connection[]): string {
  return JSON.stringify(list);
}

/**
 * Coerce one raw parsed item into a well-formed Connection, or null when its
 * shape is invalid. Shared by storage parsing and connection import (#188) so the
 * accepted shape is defined once. Non-string param values are dropped.
 */
export function coerceConnection(item: unknown): Connection | null {
  const c = item as Partial<Connection> | null;
  if (
    !c ||
    typeof c.id !== "string" ||
    typeof c.name !== "string" ||
    typeof c.driver !== "string" ||
    c.params === null ||
    typeof c.params !== "object"
  ) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.params as Record<string, unknown>)) {
    if (typeof v === "string") {
      params[k] = v;
    }
  }
  const conn: Connection = { id: c.id, name: c.name, driver: c.driver, params };
  if (typeof c.color === "string" && c.color) {
    conn.color = c.color;
  }
  return conn;
}

/** Tolerant parse of stored connections; malformed entries are dropped. */
export function parseConnections(raw: string | null): Connection[] {
  if (!raw) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(coerceConnection).filter((c): c is Connection => c !== null);
}
