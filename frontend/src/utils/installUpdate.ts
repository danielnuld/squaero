// In-app updater: ask the native shell to download the release MSI and run it
// (see app/src/main.cc `quaeroDownloadAndInstall`). Available only inside the
// Windows shell; elsewhere callers fall back to opening the download in a browser.

interface InstallHost {
  quaeroDownloadAndInstall?: (url: string) => Promise<{ ok: boolean }>;
}

/** True when the native download-and-install bridge is available. */
export function canInstall(): boolean {
  return typeof (globalThis as InstallHost).quaeroDownloadAndInstall === "function";
}

/**
 * Download and launch the installer for `url`. Resolves true when the download
 * succeeded (the app then closes and the installer runs); false on any failure,
 * so the caller can fall back to a browser download.
 */
export async function installUpdate(url: string): Promise<boolean> {
  const fn = (globalThis as InstallHost).quaeroDownloadAndInstall;
  if (typeof fn !== "function") return false;
  try {
    const r = await fn(url);
    return !!r?.ok;
  } catch {
    return false;
  }
}
