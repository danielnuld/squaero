# SQLite driver

The reference Quaero driver and the template for all others: pure C, serverless,
built against the vendored SQLite amalgamation (`third_party/sqlite`). It builds
as a runtime-loaded plugin (`sqlite.dll` / `sqlite.so` / `sqlite.dylib`)
implementing the vtable in [`docs/DRIVER_API.md`](../../docs/DRIVER_API.md).

## DSN

JSON with a single `path` (a file path, or `:memory:` for an in-memory db):

```json
{ "path": "/var/data/app.db" }
```

## Capabilities

This milestone (M1) backs the **required** surface only:

- `connect` / `disconnect` / `last_error`
- `query` + result-set iteration (`col_count`, `col_name`, `col_type`,
  `next_row`, `cell_text`), `free_result`, `rows_affected`

`features` is `0`: introspection, transactions and DDL generation are not yet
advertised and their vtable slots are `NULL`. They land in later milestones,
which will set the matching `DBC_FEAT_*` flag.

Column types are derived from each column's declared type via SQLite's
type-affinity rules (`src/utils/types.c`).

## Layout

```text
src/entry.c        vtable wiring + dbc_driver_entry (thin)
src/connection.c   connect/disconnect/last_error, DSN(JSON) parsing
src/query.c        execute + result iteration + rows_affected
src/utils/types.c  SQLite declared type -> neutral dbc_type
```
