// Which engines this run can actually test, decided once in globalSetup and read by
// every worker.
//
// A skipped engine is the honest outcome on a laptop that does not have it. But a
// silent skip is a trap: a CI job could go green having tested nothing at all. So
// QUAERO_E2E_REQUIRE lists the engines whose absence must be a failure instead.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { EngineName } from "./engines";

export interface Availability {
  readonly name: EngineName;
  readonly available: boolean;
  readonly reason: string;
}

/** Shared between the setup process and the workers, so it has to be on disk. */
export const AVAILABILITY_FILE = join(
  import.meta.dirname,
  "..",
  ".availability.json",
);

export function writeAvailability(list: readonly Availability[]): void {
  mkdirSync(dirname(AVAILABILITY_FILE), { recursive: true });
  writeFileSync(AVAILABILITY_FILE, JSON.stringify(list, null, 2), "utf8");
}

/** Read synchronously: the skip decision happens while tests are being collected. */
export function readAvailability(): readonly Availability[] {
  if (!existsSync(AVAILABILITY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(AVAILABILITY_FILE, "utf8")) as Availability[];
  } catch {
    return [];
  }
}

/** Engines whose absence is a failure rather than a skip. */
export function requiredEngines(): readonly string[] {
  return (process.env.QUAERO_E2E_REQUIRE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function isRequired(name: EngineName): boolean {
  return requiredEngines().includes(name);
}

export function statusOf(name: EngineName): Availability {
  const found = readAvailability().find((a) => a.name === name);
  return (
    found ?? {
      name,
      available: false,
      reason: "not probed (globalSetup did not run, or it found no such engine)",
    }
  );
}
