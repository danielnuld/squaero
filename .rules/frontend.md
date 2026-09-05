# Frontend Rules

The frontend is the web UI rendered in the OS webview.

1. **Talk to the core only via IPC.** Use the contract in
   [`docs/IPC.md`](../docs/IPC.md). The frontend never assumes native C or
   database types — it consumes the JSON model the core sends.
2. **Virtualization is mandatory.** Never render rows or tree nodes outside the
   viewport. Grids and object trees page/lazy-load against the core. This is the
   core reason Squaero stays fast — treat it as a hard requirement, not an
   optimization.
3. **Format from metadata, not inference.** Each column carries its neutral
   `type`; the UI formats based on it and never guesses from values.
4. **Extract pure logic to `src/utils/`.** Formatters, parsers, sort/filter
   logic and SQL helpers go in `src/utils/` with plain descriptive names
   (no `Utils` suffix). Components stay presentational.
5. **Tooling:** pnpm + Vite. Assets are bundled and embedded in the binary.
6. **Tests:** vitest, in a parallel `tests/` tree mirroring `src/` — see
   `testing.md`. Every exported util has tests.
