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
export const REPO_URL = "https://github.com/danielnuld/squaero";

/** The user manual, on the project site (Ayuda › Documentación, A-11). */
export const DOCS_URL = "https://danielnuld.github.io/squaero/manual/";

/** Where About's links point (issue #694). */
export const ABOUT_LINKS = {
  repo: REPO_URL,
  releases: `${REPO_URL}/releases`,
  licence: `${REPO_URL}/blob/main/LICENSE`,
  thirdParty: `${REPO_URL}/blob/main/THIRD-PARTY.md`,
  issues: `${REPO_URL}/issues/new`,
} as const;

/**
 * The facts a bug report needs, as plain text for the clipboard (issue #694).
 * A core that did not answer is said as such, not left blank.
 */
export function aboutReport(f: {
  app: string;
  core: string | null;
  protocol: number | null;
  system: string;
}): string {
  return [
    `Squaero ${f.app}`,
    `libdbcore ${f.core ?? "?"}`,
    `IPC ${f.protocol === null ? "?" : `v${f.protocol}`}`,
    f.system,
  ].join("\n");
}

/**
 * The «Sistema» line of About (M14 SettingsAbout): the OS and, when the
 * webview's user agent says so, the architecture — «Windows · x64». Only what
 * the strings state; no version is guessed from them.
 */
export function systemLine(platform: string, userAgent: string): string {
  const both = `${platform} ${userAgent}`;
  const os = /mac/i.test(both) ? "macOS" : /win/i.test(both) ? "Windows" : /linux|x11/i.test(both) ? "Linux" : platform || "?";
  const arch = /arm64|aarch64/i.test(both) ? "arm64" : /x64|x86_64|win64|amd64|wow64/i.test(both) ? "x64" : null;
  return arch ? `${os} · ${arch}` : os;
}
