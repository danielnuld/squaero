// App identity shown in the About section (issue #181). The frontend version is
// injected at build time from the repo-root VERSION file via a Vite `define`
// (the single source of truth shared with CMake and the Windows VERSIONINFO —
// see docs/VERSIONING.md and issue #192).
// The CORE version and IPC protocol version are NOT hardcoded here — they are
// read live from the `app.hello` handshake (see docs/IPC.md), which is the
// runtime source of truth; About queries the core and displays what it reports.

// Replaced by Vite at build; absent under vitest, where the guard falls back.
declare const __APP_VERSION__: string;

/** The frontend app version (from package.json), or "dev" when not injected. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** Public source repository, linked from About. */
export const REPO_URL = "https://github.com/danielnuld/quaero";
