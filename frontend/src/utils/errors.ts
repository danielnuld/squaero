// Turn a raw error (a JSON-RPC domain error from the core, or any thrown value)
// into a clear, actionable message for the UI (issue #42). Pure and tested.
//
// The core reports domain failures with the codes in docs/IPC.md; QueryError
// carries that code. We map each to a short, human title plus, when it adds
// information, the raw detail from the core.

import { QueryError } from "./query";
import { locale, translate, type Locale } from "./i18n";
import { informixErrorText } from "./informixErrors";
import { NOT_RETRIED_KEY, type NotRetried } from "./reconnect";

export interface FriendlyError {
  /** Short, actionable sentence. */
  title: string;
  /** Raw underlying message, when it adds detail beyond the title. */
  detail?: string;
}

// JSON-RPC codes (see docs/IPC.md "Códigos de error") → catalog key. The
// domain codes (-3200x) describe user-facing failures; the standard ones
// (-326xx/-32700) signal a client/core mismatch, not user error.
const CODES: Record<number, string> = {
  [-32000]: "error.rpc.connect",
  [-32001]: "error.rpc.unsupported",
  [-32002]: "error.rpc.notFound",
  [-32003]: "error.rpc.queryFailed",
  [-32700]: "error.rpc.parse",
  [-32600]: "error.rpc.invalidRequest",
  [-32601]: "error.rpc.noMethod",
  [-32602]: "error.rpc.invalidParams",
  [-32603]: "error.rpc.internal",
};

/** Map any error into a friendly {title, detail}. */
export function describeError(err: unknown, lang: Locale = locale()): FriendlyError {
  const unknown = translate(lang, "error.unknown");
  if (err instanceof QueryError) {
    // A dead session the transport did not retry says why (issue #676): the
    // generic -32000 title ("check the host…") is wrong for a connection that
    // was working a moment ago.
    const why = (err.data as { notRetried?: NotRetried } | undefined)?.notRetried;
    if (why && NOT_RETRIED_KEY[why]) {
      return { title: translate(lang, NOT_RETRIED_KEY[why]), detail: err.message || undefined };
    }
    // An Informix SQLCODE says more than the generic domain title (#559); the
    // raw code, SQLSTATE and tokens stay as detail, to search or report.
    const ifx = informixErrorText(err.message, lang);
    if (ifx) return { title: ifx, detail: err.message };
    const key = CODES[err.code];
    if (key) {
      const known = translate(lang, key);
      // Keep the core's own message as detail when it says more than the title.
      const detail = err.message && err.message !== known ? err.message : undefined;
      return { title: known, detail };
    }
    return { title: err.message || unknown };
  }
  if (err instanceof Error) return { title: err.message || unknown };
  return { title: String(err) };
}

/** One-line rendering of an error, title plus detail. */
export function errorText(err: unknown): string {
  const f = describeError(err);
  return f.detail ? `${f.title} (${f.detail})` : f.title;
}
