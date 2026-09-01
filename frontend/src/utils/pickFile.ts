// Open the host's native "open file" dialog and resolve to the chosen absolute
// path, or null when the user cancels or the host has no picker. The native
// shell binds `quaeroPickFile` (GetOpenFileName on Windows, see app/src/main.cc);
// a webview <input type="file"> is no use here — it hands JS the file name, never
// the path the core has to open.
// ponytail: Windows only; on other hosts the field stays a typed path.

interface PickFileHost {
  quaeroPickFile?: (title: string) => Promise<string | null>;
}

export function canPickFile(): boolean {
  return typeof (globalThis as PickFileHost).quaeroPickFile === "function";
}

export async function pickFile(title: string): Promise<string | null> {
  const fn = (globalThis as PickFileHost).quaeroPickFile;
  if (typeof fn !== "function") return null;
  try {
    return await fn(title);
  } catch {
    return null;
  }
}
