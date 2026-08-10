# End-to-end suite

Drives the **shipped frontend** against the **real C core**, the **real driver
plugins** and **real databases**. Nothing between the browser and the database is
mocked, stubbed or faked.

This is the only place the interface and the core are tested *together*. `ctest`
covers the core and the drivers' pure helpers, `vitest` covers the frontend's
utils, and `scripts/smoke/smoke.mjs` walks the critical path with no interface at
all — none of them would have caught the two bugs that motivated this suite: a
grid that loaded forever because of one invalid byte (#315), and a `LIKE '%ñada%'`
that silently returned nothing (#324).

## How it works

```
Playwright (Node)                      Chromium
  quaero-rpc (child process)  <---->   window.quaeroRpc   (injected)
     |  one JSON request per line        ^ exposeFunction + addInitScript
     v
  real C core + real driver plugins -> Postgres / MySQL / Informix / SQLite
```

`src/utils/transport.ts` calls exactly one global,
`globalThis.quaeroRpc(requestJson)`. The native shell binds it to the webview
host; the harness binds it to a live `quaero-rpc`. **No production code changes**:
`hasBridge()` already tolerates the global being absent, which is what `pnpm dev`
relies on.

## Running it

```bash
pnpm e2e:install     # once: downloads Chromium
pnpm e2e             # the whole suite
pnpm e2e:ui          # interactive, for writing tests
pnpm e2e harness     # one file
```

The config builds the frontend and serves `dist/` with `vite preview`. While
writing tests, run `pnpm preview --port 4173 --strictPort --host 127.0.0.1`
yourself and the suite will reuse it instead of rebuilding each time.

### Databases

The containers come from the encoding work (#323). Start them with:

```bash
docker start quaero-pg-test quaero-my-test quaero-ifx-test
```

Informix takes about a minute to come online. SQLite needs nothing.

**An engine you cannot reach is skipped, not failed** — the run prints why, and
the command that would fix it. That keeps the suite usable on a machine with only
some engines. Because a silent skip would let a CI job go green having tested
nothing, `QUAERO_E2E_REQUIRE` turns a skip into a failure:

```bash
QUAERO_E2E_REQUIRE=sqlite,postgres,mysql pnpm e2e
```

### One architecture: x86

Quaero ships as an x86 build — Informix forces it, because IBM's ODBC driver is
32-bit only — so the suite drives the x86 build and nothing else. That is
deliberate: if the shipped architecture cannot do something, the suite must go red
rather than route around it through a build no user has. (It did, once: the x86
MySQL client had no `caching_sha2_password`, the default auth of every MySQL since
8.0, so a stock MySQL 8 was unreachable. The harness found it on its first run and
it was fixed in the build, not worked around here.)

Override with `QUAERO_RPC` / `QUAERO_DRIVERS` if you need to point at another build.

The harness also puts the app directories and the 32-bit mingw runtime on the
child's `PATH` by itself. Without that, plugins fail to load with a bare "could
not load library" that explains nothing — it cost us two afternoons before it was
written down here.

## Adding a test

```ts
import { describeEngine, test, expect } from "./support/fixtures";

describeEngine("postgres", () => {
  test("shows the accented value as the database means it", async ({ app }) => {
    await app.open();
    // app.page   the browser page, bridge installed, state pinned
    // app.engine the engine spec, including what its encoding rows must show
    // app.rpc    the live core, to set up or verify outside the UI
  });
});
```

`describeAllEngines([...], (name) => { ... })` covers the whole matrix in one
file.

Every file rebuilds its engine's fixture before running, so two runs in a row
start from identical data however much the previous one inserted or deleted.

### House rules

- **Locate by role or accessible name**, never by CSS class or DOM position. A
  class-based selector breaks on the next refactor and tests nothing a user can
  perceive. When a control cannot be reached accessibly, **add the label to the
  component** and note it in the change's `tasks.md` — a `data-testid` is visible
  only to the test, an `aria-label` helps the user too.
- **Never wait on time.** Wait on a condition. There are no retries configured:
  a test that only passes sometimes gets fixed or deleted the same day, because a
  suite nobody trusts teaches people to ignore red.
- **Assert exact values on encoding.** `ñ` versus `Ã±` is the whole difference
  between a fix and the appearance of one; "contains an accent" would have passed
  while the bug was live.
- The fixtures deliberately include a value whose bytes are valid UTF-8 for a
  *different* character than the database means, and values holding bytes
  `0x80–0x9F`. `engine.encodingRows` says what each engine must show — and the
  expectations differ per engine on purpose, because MySQL's `latin1` is really
  CP1252 while PostgreSQL's is true ISO 8859-1. One shared expectation would be
  asserting a bug.

## What this does NOT cover

The **native shell**: the window, menus, file dialogs, `localStorage`
persistence per origin, the update modal, opening external links. None of it can
be driven from a browser. A minimal CDP smoke against the real executable is
proposed as a later phase — the risk is not the gap, it is forgetting it exists.
