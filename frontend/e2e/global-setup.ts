// Runs once before the suite: work out which engines can be tested, seed their
// fixtures, and record the verdict for the workers to read.
//
// Doing this once rather than per test file keeps the cost of loading five driver
// plugins and reaching four databases to a single payment.

import { join } from "node:path";

import { writeAvailability } from "./support/availability";
import { assertFresh } from "./support/freshness";
import { binaryPath, driversPath } from "./support/rpc";
import { probeEngines } from "./support/seed";
import { startHint } from "./support/engines";

export default async function globalSetup(): Promise<void> {
  // One binary for every engine: x86 is the architecture Quaero ships, so it is
  // the only one worth testing. Anything the x86 build cannot do is a real defect,
  // not something for the suite to route around.
  console.log(`[e2e] core bridge: ${binaryPath()}`);
  console.log(`[e2e] driver dir : ${driversPath()}`);

  // Refuse to run against binaries older than the source. A stale plugin once made
  // PostgreSQL look broken when the fix simply had never been compiled for x86 —
  // and the same trap can just as easily report green about code that was never
  // built. See support/freshness.ts.
  assertFresh(join(import.meta.dirname, "..", ".."), binaryPath(), driversPath());

  const results = await probeEngines();
  writeAvailability(results);

  for (const r of results) {
    if (r.available) {
      console.log(`[e2e] ${r.name.padEnd(9)} ready`);
    } else {
      console.log(`[e2e] ${r.name.padEnd(9)} UNAVAILABLE — ${r.reason}`);
      console.log(`[e2e] ${" ".repeat(9)} start it with: ${startHint(r.name)}`);
    }
  }

  if (results.every((r) => !r.available)) {
    console.log(
      "[e2e] no engine is available: every test will be skipped. " +
        "That is not the same as passing.",
    );
  }
}
