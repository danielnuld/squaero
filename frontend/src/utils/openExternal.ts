// Open an http(s) URL in the user's default browser. The native shell binds
// `quaeroOpenExternal` (ShellExecute on Windows, see app/src/main.cc); in a plain
// browser (pnpm dev) it falls back to window.open.

interface OpenExternalHost {
  quaeroOpenExternal?: (url: string) => void;
}

export function openExternal(url: string): void {
  const fn = (globalThis as OpenExternalHost).quaeroOpenExternal;
  if (typeof fn === "function") {
    fn(url);
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener");
  }
}
