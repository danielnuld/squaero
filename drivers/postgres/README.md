# PostgreSQL driver

A Quaero driver for PostgreSQL, built against **libpq** (the official C client).
It builds as a runtime-loaded plugin (`postgres.dll` / `postgres.so` /
`postgres.dylib`) implementing the vtable in
[`docs/DRIVER_API.md`](../../docs/DRIVER_API.md).

## DSN

JSON; every field is optional except as your server requires. `database` is the
neutral key (mapped to libpq's `dbname`). libpq still honors the usual `PG*`
environment variables and `.pgpass` for anything omitted here.

```json
{
  "host": "127.0.0.1",
  "port": "5432",
  "database": "app",
  "user": "postgres",
  "password": "secret",
  "sslmode": "require",
  "sslrootcert": "/path/ca.crt",
  "sslcert": "/path/client.crt",
  "sslkey": "/path/client.key"
}
```

`sslmode` is a standard libpq value: `disable`, `allow`, `prefer` (client
default), `require`, `verify-ca` or `verify-full`. The engine-agnostic SSH tunnel
is applied by the core before the driver connects.

## Capabilities

`features` advertises `SSL | SCHEMAS | INTROSPECTION | DDL | TRANSACTIONS | DML |
CANCEL`:

- **connect / query / result-set** (required): buffered result sets via
  `PQexec`; `rows_affected` from `PQcmdTuples` for non-`SELECT` statements.
- **introspection**: `list_databases`, `list_schemas`, `list_tables`,
  `describe_table` over the system catalogs, projected to the neutral column
  convention. PostgreSQL has real schemas within a database, so `DBC_FEAT_SCHEMAS`
  is set and the object tree is *database → schema → object*.
- **transactions**: `BEGIN` / `COMMIT` / `ROLLBACK`.
- **DDL** (`get_ddl`): reconstructs a `CREATE TABLE` from the catalog (columns
  with declared type, `NOT NULL`, `DEFAULT`, and a `PRIMARY KEY` clause).
  PostgreSQL has no `SHOW CREATE`, so this is a best-effort reconstruction of the
  common shape; it does not reproduce foreign keys, checks or indexes.
- **DML** (`build_dml`): builds the literal `INSERT` / `UPDATE` / `DELETE` for a
  single row, identifiers double-quoted and values escaped as SQL literals. The
  literal escaping is a pure function (unit-tested without a server) and assumes
  `standard_conforming_strings` is **on** — the default since PostgreSQL 9.1, so
  only the single quote is doubled and a backslash is an ordinary character. With
  the deprecated `standard_conforming_strings = off`, prefer editing through plain
  `query.run`. (Catalog and DDL paths instead use libpq's connection-aware
  `PQescapeLiteral`, which is correct under either setting.)
- **cancel**: libpq's thread-safe `PQcancel` interrupts the running query.

Types map from PostgreSQL type OIDs to the neutral `dbc_type` in
`src/utils/types.c`; unknown/user-defined OIDs exchange as text.

## Layout

```text
src/entry.c            vtable wiring + dbc_driver_entry (thin)
src/connection.c       connect/disconnect/last_error/cancel, DSN(JSON) parsing
src/query.c            execute + result iteration + rows_affected + transactions
src/metadata.c         list_databases/schemas/tables + describe_table (catalogs)
src/ddl.c              CREATE TABLE reconstruction (get_ddl)
src/edit.c             build_dml wiring
src/utils/types.c      PostgreSQL OID -> neutral dbc_type (pure, tested)
src/utils/identifier.c identifier quoting (pure, tested)
src/utils/dml.c        single-row DML builder (pure, tested)
```

## Building

The plugin builds only when libpq is discoverable. `pg_config` (on `PATH`) is
used as a hint, then CMake's default search. Point at a specific install with
`-DPG_INCLUDE_DIR=...` / `-DPG_LIBRARY=...` if needed. Where libpq is absent the
plugin is skipped (a green build) and only the pure unit tests are built.
