// Turn a raw error (a JSON-RPC domain error from the core, or any thrown value)
// into a clear, actionable message for the UI (issue #42). Pure and tested.
//
// The core reports domain failures with the codes in docs/IPC.md; QueryError
// carries that code. We map each to a short, human title plus, when it adds
// information, the raw detail from the core.

import { QueryError } from "./query";

export interface FriendlyError {
  /** Short, actionable sentence. */
  title: string;
  /** Raw underlying message, when it adds detail beyond the title. */
  detail?: string;
}

// JSON-RPC domain codes (see docs/IPC.md "Códigos de error").
const DOMAIN: Record<number, string> = {
  [-32000]: "No se pudo conectar. Revisa el host, el puerto y las credenciales.",
  [-32001]: "Operación no soportada por este motor.",
  [-32002]: "Conexión o recurso no encontrado. Vuelve a abrir la conexión.",
  [-32003]: "La consulta falló al ejecutarse.",
};

// Standard JSON-RPC codes — these signal a client/core mismatch, not user error.
const STANDARD: Record<number, string> = {
  [-32700]: "Respuesta inválida del núcleo.",
  [-32600]: "Petición inválida.",
  [-32601]: "Método no disponible (versión del núcleo incompatible).",
  [-32602]: "Parámetros inválidos.",
  [-32603]: "Error interno del núcleo.",
};

/** Map any error into a friendly {title, detail}. */
export function describeError(err: unknown): FriendlyError {
  if (err instanceof QueryError) {
    const known = DOMAIN[err.code] ?? STANDARD[err.code];
    if (known) {
      // Keep the core's own message as detail when it says more than the title.
      const detail = err.message && err.message !== known ? err.message : undefined;
      return { title: known, detail };
    }
    return { title: err.message || "Error desconocido." };
  }
  if (err instanceof Error) return { title: err.message || "Error desconocido." };
  return { title: String(err) };
}

/** One-line rendering of an error, title plus detail. */
export function errorText(err: unknown): string {
  const f = describeError(err);
  return f.detail ? `${f.title} (${f.detail})` : f.title;
}
