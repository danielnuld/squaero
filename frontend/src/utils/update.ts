// Update check against GitHub Releases (autoupdater, issue: startup update modal).
// On launch the app asks GitHub for the latest release, compares its version with
// the running one, and — when newer — surfaces a modal with the changelog and a
// download link. The comparison and parsing are pure and unit-tested; the fetch
// is a thin, injectable wrapper, and every failure is swallowed (a background
// update check must never disrupt startup).

import { REPO_URL } from "./version";
import { resolveStore } from "./kvStore";

const LATEST_URL = "https://api.github.com/repos/danielnuld/quaero/releases/latest";
const SKIP_KEY = "quaero.update.skip";

export interface UpdateInfo {
  /** Version of the latest release, without the leading `v`. */
  version: string;
  /** Release notes / changelog (GitHub release body, markdown). */
  notes: string;
  /** The release page on GitHub. */
  releaseUrl: string;
  /** Direct download URL of the .msi asset, or null when absent. */
  downloadUrl: string | null;
}

/** Compare two `X.Y.Z` versions (a leading `v` is ignored). Returns >0 when a is
 *  newer than b, <0 when older, 0 when equal. Missing/non-numeric parts are 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Shape a GitHub `releases/latest` response into UpdateInfo, or null if it is
 *  not a usable release object. */
export function parseLatestRelease(data: unknown): UpdateInfo | null {
  if (!data || typeof data !== "object") return null;
  const r = data as {
    tag_name?: unknown;
    body?: unknown;
    html_url?: unknown;
    assets?: unknown;
  };
  if (typeof r.tag_name !== "string" || !r.tag_name) return null;
  const version = r.tag_name.replace(/^v/, "");
  const notes = typeof r.body === "string" ? r.body : "";
  const releaseUrl = typeof r.html_url === "string" ? r.html_url : `${REPO_URL}/releases`;
  let downloadUrl: string | null = null;
  if (Array.isArray(r.assets)) {
    const msi = r.assets.find(
      (a): a is { name: string; browser_download_url: string } =>
        !!a &&
        typeof a.name === "string" &&
        a.name.toLowerCase().endsWith(".msi") &&
        typeof a.browser_download_url === "string",
    );
    downloadUrl = msi ? msi.browser_download_url : null;
  }
  return { version, notes, releaseUrl, downloadUrl };
}

/**
 * Check GitHub for a newer release than `current`. Returns the update when the
 * latest is strictly newer, else null (also for `dev` builds, network/API
 * errors, or a malformed response). `fetchImpl` is injectable for tests.
 */
export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  if (!current || current === "dev") return null;
  try {
    const res = await fetchImpl(LATEST_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const info = parseLatestRelease(await res.json());
    if (!info) return null;
    return compareVersions(info.version, current) > 0 ? info : null;
  } catch {
    return null;
  }
}

/** The version the user chose to skip ("Ahora no"), or null. Best-effort. */
export function loadSkippedVersion(): string | null {
  try {
    return resolveStore().getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

/** Remember a version so its update modal is not shown again. Best-effort. */
export function saveSkippedVersion(version: string): void {
  try {
    resolveStore().setItem(SKIP_KEY, version);
  } catch {
    /* best-effort */
  }
}
