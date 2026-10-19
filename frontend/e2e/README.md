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

Informix is reached over DRDA (issue #557), on the container's `drsoctcp`
listener, port 9089, which the container must publish. A container made before
that only published 9088; make it again with both, then create the Latin-1
database the encoding checks use:

```bash
docker run -d --name quaero-ifx-test -h ifx -e LICENSE=accept   -p 9088:9088 -p 9089:9089 icr.io/informix/informix-developer-database
# once it is on-line:
docker exec quaero-ifx-test bash -lc 'echo "create database quaero_enc with log" | dbaccess sysmaster -'
```

`QUAERO_E2E_IFX_PORT` points the suite at another port.

**An engine you cannot reach is skipped, not failed** — the run prints why, and
the command that would fix it. That keeps the suite usable on a machine with only
some engines. Because a silent skip would let a CI job go green having tested
nothing, `QUAERO_E2E_REQUIRE` turns a skip into a failure:

```bash
QUAERO_E2E_REQUIRE=sqlite,postgres,mysql pnpm e2e
```

### One architecture: x86

Squaero ships as an x86 build (IBM's 32-bit ODBC driver forced it until #557),
so the suite drives the x86 build and nothing else. That is
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

## Visual regression

`e2e/visual/screens.spec.ts` photographs the main screens — welcome, connection
search and form, object tree with a table grid, the SQL editor with a result (its
toast and the status bar in the frame), settings, and the DROP confirm dialog — in
light and dark, and compares each capture with the baseline committed under
`e2e/visual/__screenshots__/`. It has its own config,
`playwright.visual.config.ts`, and its own CI job (`.github/workflows/visual.yml`),
for the same reason the media capture has: the suite above asks "does it work?",
this asks "does it still look the same?", and the answer to that depends on the
machine.

```bash
pnpm visual          # compare (skips with a reason off Linux)
pnpm visual:update   # rewrite the baselines — Linux only, see below
```

Locally it needs what the suite needs: the core built (`QUAERO_RPC`,
`QUAERO_DRIVERS` point it at a build; SQLite is the only engine it uses) and
Chromium installed.

### What makes a capture repeatable

- **Geometry**: 1280×800 at `deviceScaleFactor: 1`, in the config.
- **Data**: the same SQLite fixture every e2e test reseeds.
- **Time**: `page.clock` freezes `Date`, timers and `performance.now`, so the run
  toast reads "Ejecutada a las 10:30:00 · 0 ms", stays on screen instead of timing
  out, and the status bar's duration never varies. The time zone and locale are
  pinned in the config for the same reason.
- **Motion**: `reducedMotion: "reduce"` (which `styles.css` honours by zeroing every
  transition), `animations: "disabled"` and `caret: "hide"` on the comparison.
- **Theme**: written to `quaero.theme` before the page loads, never toggled — the
  button cycles system → light → dark and would land wherever the last run left it.
  The test asserts the theme that was *painted* (`html[data-theme]`).
- **Platform**: one. `--font-ui` resolves to Segoe UI on Windows and to
  DejaVu/Liberation in the CI container, so the same screen never matches across
  operating systems. Baselines are made and compared in
  `mcr.microsoft.com/playwright:<version>-jammy` only, and the spec skips
  elsewhere. `QUAERO_VISUAL_ANY_OS=1` overrides the skip to prove the walk works on
  a laptop; what that writes must not be committed.

### Tolerance

`threshold: 0.2` is the per-pixel colour distance (YIQ, 0–1) under which two pixels
count as equal; it absorbs anti-aliasing and sub-pixel text noise, while a changed
colour token moves every pixel of a surface by far more. `maxDiffPixelRatio: 0.01`
is the share of pixels allowed to differ: 1% of 1280×800 is about 10k pixels, room
for a relabelled control or two, not for a shifted panel, a missing border or a
reflowed grid. Both live in `playwright.visual.config.ts`.

### When to update the baselines

- A **deliberate** change of appearance: a new token, a redesigned panel, a
  relabelled screen, a new element in one of the photographed views. The diff is
  the review: look at it and say so in the PR.
- The **Playwright version** changes (the container tag in `visual.yml` moves with
  `@playwright/test` in `package.json`): a browser one version off can render text
  differently.

Not when a test fails and nobody knows why. An unexplained diff is a regression or a
non-deterministic capture, and either gets fixed, not re-baselined.

### How to update them

The baselines are Linux pixels, so they come from the container, never from a
laptop. Two routes to the same bytes:

1. **In CI** (the normal route): Actions → *Visual baselines* → *Run workflow*,
   pick your branch, leave *update* on. The job builds the core, rewrites the
   PNGs, uploads them as the `visual-baselines` artifact and commits them to the
   branch as you (`test(frontend): update visual baselines (refs #697)`). Pull,
   look at the diff — GitHub renders PNG diffs side by side — and the PR carries
   the new look.
2. **In Docker**, when you want to iterate before pushing: from the repository root,

   ```bash
   docker run --rm -it -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.62.1-jammy bash
   apt-get update && apt-get install -y --no-install-recommends build-essential cmake ninja-build
   cmake -S . -B build-visual -G Ninja -DCMAKE_BUILD_TYPE=Debug -DQUAERO_BUILD_APP=OFF
   cmake --build build-visual --target quaero-rpc sqlite_driver
   cd frontend && npm i -g pnpm@11 && pnpm install --frozen-lockfile
   QUAERO_RPC=/work/build-visual/tools/quaero-rpc QUAERO_DRIVERS=/work/build-visual/drivers/sqlite pnpm visual:update
   ```

   Keep the image tag equal to the one in `visual.yml`.

### Reviewing a failure

The job uploads `visual-diff`: for every failed screen, `*-expected.png`,
`*-actual.png` and `*-diff.png` (changed pixels in red) under `test-results/`,
plus the HTML report, which shows the three side by side with a slider. If the
change is what the PR meant to do, update as above; if not, it found something.

**No baselines yet.** While `__screenshots__/` holds no PNG the job fails with a
message that says to run the update workflow. On purpose: a comparison against
nothing is not a pass, and generating the first set is one click away. The first
set is provisional — M14's redesign (#678) is still landing, and each phase that
changes the look re-baselines as part of its PR.

## Media capture

The screenshots of the README, the site and the manual are shot, not drawn:

```bash
docker start quaero-demo-mysql   # first time: the docker run in e2e/support/demo.ts
pnpm media
```

`pnpm media` runs `e2e/media/screenshots.spec.ts` (its own config,
`playwright.media.config.ts`) against the demo database, writes the PNG sources
to `assets/media/`, then `scripts/site-images.mjs` writes `site/img/<name>.avif`,
`.webp` and `.png` with ffmpeg (needs it on `PATH`). One test per image, so a
broken screen costs only its own picture. The main window is shot once per M14
style (`screenshot-main-{nativo,quiet,editorial,rosa}`); the style is written to
`quaero.themeId` / `quaero.theme` before load and the painted background and
accent are checked against the theme's tokens (`e2e/support/media.ts`).

- **Selectors** are roles and accessible names, collected in `e2e/support/media.ts`,
  so a layout change means updating a label there, not rewriting the spec.
- **Browser**: the full Chromium (`channel: "chromium"`) with `--lang=es-ES`; the
  headless shell has no locales and draws a file input as "Choose File".
- **Core**: like the suite, `build-x64` by default, or `QUAERO_RPC` /
  `QUAERO_DRIVERS`. Use a MariaDB Connector/C build (`-DQUAERO_MARIADB=ON`, as
  the release): the libmywire one (`-DQUAERO_MYWIRE=ON`) intermittently fails its
  first login to MySQL 8.4 with "packet out of sequence from the server".
- **Not shot**: MongoDB, the iPhone app and the MCP server (the demo is a MySQL
  in a desktop window), and the reconnect after a dropped session (it needs the
  server killed mid-capture).

Commit the images with the change that altered the screens, after looking at
every one of them.

## What this does NOT cover

The **native shell**: the window, menus, file dialogs, `localStorage`
persistence per origin, the update modal, opening external links. None of it can
be driven from a browser. A minimal CDP smoke against the real executable is
proposed as a later phase — the risk is not the gap, it is forgetting it exists.
