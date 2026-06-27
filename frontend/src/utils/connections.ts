// Connection model and pure helpers for the connection manager (issue #16).
// Connection definitions are UI/config state, persisted client-side; the core
// has no conn.save/list (it only opens/closes active connections), so this is
// the source of truth for saved connections. Secrets (passwords) are never
// written to storage — they are entered at connect time.
//
// Forms are data-driven: each driver declares its DSN fields, so a new engine
// only adds a schema entry. The dsn object built here is what conn.open expects
// (see docs/IPC.md).

export type FieldType = "text" | "number" | "password" | "file";

export interface DriverField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
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
}

// Driver form schemas. SQLite is the reference engine shipped in M2; the
// PostgreSQL schema is defined for the data-driven form and lands as a usable
// option when its driver is built (M4).
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
    fields: [
      { key: "host", label: "Host", type: "text", required: true, placeholder: "localhost" },
      { key: "port", label: "Puerto", type: "number", required: false, placeholder: "5432" },
      { key: "database", label: "Base de datos", type: "text", required: true },
      { key: "user", label: "Usuario", type: "text", required: true },
      { key: "password", label: "Contraseña", type: "password", required: false },
    ],
  },
};

// Drivers the UI offers. Only engines whose driver actually ships are listed,
// so the UI never advertises a connection it cannot honor (honest capabilities).
export const AVAILABLE_DRIVERS: string[] = ["sqlite"];

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

/** Serializes connections for storage, stripping secrets from each. */
export function serializeConnections(list: Connection[]): string {
  const safe = list.map((c) => {
    const schema = driverSchema(c.driver);
    return schema ? stripSecrets(c, schema) : c;
  });
  return JSON.stringify(safe);
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
  const out: Connection[] = [];
  for (const item of data) {
    const c = item as Partial<Connection>;
    if (
      typeof c?.id === "string" &&
      typeof c?.name === "string" &&
      typeof c?.driver === "string" &&
      c.params !== null &&
      typeof c.params === "object"
    ) {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.params as Record<string, unknown>)) {
        if (typeof v === "string") {
          params[k] = v;
        }
      }
      out.push({ id: c.id, name: c.name, driver: c.driver, params });
    }
  }
  return out;
}
