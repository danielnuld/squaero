# Testing Conventions

Everything testable is tested. Tests run in CI and before any change is "done".

## C (core and drivers)

- **Framework:** CTest driving a lightweight unit framework (Unity or greatest).
- **Layout:** tests live in a parallel `tests/` tree mirroring the source:

  ```
  core/
    src/result.c
    src/sql/identifier.c
  tests/
    core/result_test.c
    core/sql/identifier_test.c
  drivers/sqlite/
    src/query.c
  drivers/sqlite/tests/
    query_test.c
  ```

- **What to test:** every extracted pure helper — identifier quoting, SQL
  builders, type mapping, pagination math, value/JSON serialization — with
  nominal, edge (NULL/empty/boundary), and unsupported-input cases.
- **Run:** `cmake --build build && ctest --test-dir build --output-on-failure`.

## Frontend

- **Framework:** vitest (`jsdom` for DOM-touching tests).
- **Layout:** `tests/` mirrors `src/`; test files named `[name].test.ts`;
  import from `../../src/...` (relative from `tests/`).
- **What to test:** every exported util in `src/utils/` — formatters, parsers,
  sort/filter logic, SQL generators (across multiple drivers where relevant) —
  including edge cases.
- **Run:** `pnpm test` (watch: `pnpm test --watch`; coverage: `pnpm test --coverage`).

## End-to-end (frontend + core + drivers + a real database)

- **Framework:** Playwright, in `frontend/e2e/`. Run with `pnpm e2e`
  (`pnpm e2e:install` once, to fetch Chromium).
- **What it is:** the only place the interface and the core are tested *together*.
  Playwright drives the built frontend and injects `window.quaeroRpc` — the single
  global the native shell binds — pointing at a real `quaero-rpc` process. Nothing
  between the browser and the database is mocked.
- **What to test:** journeys, not units. Anything whose failure needs a real engine
  to reproduce: paging, transactional editing, DDL refresh, exports, and text
  encoding.
- **Engines:** an engine whose database or driver is missing **skips with a
  reason**; it never fails. `QUAERO_E2E_REQUIRE=a,b` turns a skip into a failure,
  so a CI job cannot pass having tested nothing.
- **House rules:** locate by role or accessible name, never by CSS class or DOM
  position; never wait on time, wait on a condition; assert exact values for
  encoding (`ñ` vs `Ã±` is the whole difference). No retries are configured on
  purpose — a flaky test is fixed or deleted the same day.
- Details, and what this deliberately does NOT cover (the native shell), are in
  `frontend/e2e/README.md`.

## Organization

Mirror module structure with `describe` blocks (TS) / test groups (C). Name tests
by behaviour, not implementation.

## Coverage expectation

- All exported/public functions have tests.
- Edge and error conditions are covered.
- SQL generators are tested against more than one driver.
