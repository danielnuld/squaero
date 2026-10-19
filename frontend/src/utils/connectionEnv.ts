// A connection's «Tipo de entorno» (R-06): Desarrollo / Pruebas / Producción.
// Picking one sets the colour and the protection a connection of that kind
// usually wants; both stay editable afterwards. Pure.

import type { SafeMode } from "./safeMode";

export type ConnEnv = "dev" | "test" | "prod";

export const CONN_ENVS: readonly ConnEnv[] = ["dev", "test", "prod"];

/** What choosing an environment sets (colours from CONNECTION_COLORS). */
export const ENV_DEFAULTS: Record<ConnEnv, { color: string; safeMode?: SafeMode }> = {
  dev: { color: "#4f7cf0" },
  test: { color: "#4bb45e" },
  prod: { color: "#e5484d", safeMode: "confirm" },
};

/** The stored value, or undefined for anything that is not a known environment. */
export function parseEnv(v: unknown): ConnEnv | undefined {
  return v === "dev" || v === "test" || v === "prod" ? v : undefined;
}

/** `c` with the environment set, and its default colour and protection. No
    environment clears only the environment: the colour and protection stay. */
export function withEnv<T extends { env?: ConnEnv; color?: string; safeMode?: SafeMode }>(
  c: T,
  env: ConnEnv | undefined,
): T {
  if (!env) return { ...c, env: undefined };
  return { ...c, env, color: ENV_DEFAULTS[env].color, safeMode: ENV_DEFAULTS[env].safeMode };
}

/**
 * The workspace stripe: the connection's own colour; without one, a protected
 * connection still gets a stripe, amber when writes are confirmed and neutral
 * when it is read-only — never the error red, which a safe state is not.
 * Undefined: no stripe.
 */
export function stripeColor(color: string | undefined, safeMode: SafeMode | undefined): string | undefined {
  if (color) return color;
  if (safeMode === "confirm") return "var(--warn)";
  if (safeMode === "readOnly") return "var(--text-dim)";
  return undefined;
}
