// Refuses to run against a stale build.
//
// This exists because of a real mistake it now prevents. The suite drives whatever
// binaries happen to be staged, and a driver DLL five days older than the source
// made PostgreSQL look broken: the encoding fix was in the tree but had never been
// compiled for x86. Two hours went into "diagnosing" a defect that did not exist.
//
// The false failure was the lucky outcome. The same trap silently produces false
// PASSES — a suite reporting green about code that was never built is worse than no
// suite at all, because it is believed.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Newest modification time under `dir`, or 0 when it does not exist. */
function newestUnder(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestUnder(path));
    } else if (/\.(c|h|cc|cmake|txt)$/i.test(entry.name)) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

function mtimeOf(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

export interface Staleness {
  readonly artifact: string;
  readonly newerSource: string;
}

/**
 * Every staged artifact older than the sources it is built from.
 *
 * `repo` is the repository root, `binary` the quaero-rpc executable and `drivers`
 * the directory its plugins are loaded from.
 */
export function findStale(
  repo: string,
  binary: string,
  drivers: string,
): Staleness[] {
  const stale: Staleness[] = [];

  // quaero-rpc links the core, so core changes must be compiled into it. This is
  // what carries the IPC boundary guard, among other things.
  const coreTime = Math.max(
    newestUnder(join(repo, "core", "src")),
    newestUnder(join(repo, "core", "include")),
    mtimeOf(join(repo, "core", "CMakeLists.txt")),
  );
  if (mtimeOf(binary) < coreTime) {
    stale.push({ artifact: binary, newerSource: "core/" });
  }

  // Each plugin against its own driver sources.
  if (existsSync(drivers)) {
    for (const entry of readdirSync(drivers, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(dll|so|dylib)$/i.test(entry.name)) {
        continue;
      }
      const name = entry.name.replace(/\.(dll|so|dylib)$/i, "");
      const srcTime = Math.max(
        newestUnder(join(repo, "drivers", name, "src")),
        mtimeOf(join(repo, "drivers", name, "CMakeLists.txt")),
      );
      if (srcTime === 0) {
        continue; // not one of ours; leave it alone
      }
      if (mtimeOf(join(drivers, entry.name)) < srcTime) {
        stale.push({
          artifact: join(drivers, entry.name),
          newerSource: `drivers/${name}/`,
        });
      }
    }
  }

  return stale;
}

/** Throws with what to rebuild when anything staged is out of date. */
export function assertFresh(repo: string, binary: string, drivers: string): void {
  const stale = findStale(repo, binary, drivers);
  if (stale.length === 0) {
    return;
  }
  const lines = stale.map((s) => `  ${s.artifact}\n    is older than ${s.newerSource}`);
  throw new Error(
    "Stale build: the suite would be testing binaries that do not match the " +
      "source, which can report green about code that was never compiled.\n\n" +
      lines.join("\n") +
      "\n\nRebuild and restage, then run again. On Windows:\n" +
      "  cmake --build build-x86 -j 4\n" +
      "  cp build-x86/drivers/*/[a-z]*.dll build-x86/app/drivers/\n" +
      "  cp build-x86/tools/quaero-rpc.exe build-x86/tools/\n",
  );
}
