# SQL Server driver

Microsoft SQL Server through [FreeTDS](https://www.freetds.org)'s db-lib (issue #49).

## DSN

```json
{ "host": "127.0.0.1", "port": "1433", "user": "sa", "password": "…",
  "database": "app", "encryption": "require" }
```

| Field | Notes |
|---|---|
| `host`, `user` | Required. |
| `port` / `instance` | One or the other; a named instance is found through SQL Browser. |
| `database` | Optional; the login's default database otherwise. |
| `encryption` | `require` (default), `request` (only if the server insists — measured as plaintext against SQL Server 2022), `off` (login only) or `strict` (TDS 8; not verified: the stock 2022 container drops the connection). |

No `freetds.conf` is read: everything goes on the login record. Text is exchanged
as UTF-8 and N-prefixed literals keep non-ASCII data intact.

## Capabilities

| Area | State |
|---|---|
| connect / query / result set | supported — last result set of a batch, row counts summed |
| type mapping | supported — `utils/types.c`; date/time as ISO 8601, binary as `0x…` |
| introspection | supported — databases, schemas of the current database, tables/views, columns |
| transactions | supported — `BEGIN/COMMIT/ROLLBACK TRANSACTION` |
| encrypted transport | supported — but the server certificate is **not verified** (db-lib cannot take a CA file) |
| DDL reconstruction, row editing | not yet — `DBC_ERR_UNSUPPORTED` |
| cancel | not advertised — db-lib's `dbcancel` is not safe from another thread |

Result sets are buffered whole in memory.

## Build

- System FreeTDS (e.g. `apt install freetds-dev`) is used when it links.
- `-DQUAERO_FREETDS=ON` builds db-lib statically from the 1.5.19 tarball
  (`cmake/QuaeroFreeTDS.cmake`), with TLS from the static OpenSSL of the x86 build.

## Tests

`tests/` covers identifier and literal quoting, type mapping, date/time and binary
formatting, and the `encryption` option.
