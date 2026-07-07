# Quaero MCP server (`quaero-mcp`)

`quaero-mcp` exposes your Quaero databases to [Model Context
Protocol](https://modelcontextprotocol.io) clients — Claude Code and any other
MCP host — as a small set of **read-only-by-default** tools. It reuses the same
C core (`libdbcore`) and driver plugins the desktop app uses, speaking MCP
(JSON-RPC 2.0) over stdio: one JSON message per line in, one per line out.

> **Binary name.** The desktop app (`quaero`) is a GUI executable with no
> console attached, so the MCP server ships as a separate console binary,
> `quaero-mcp`, rather than a `quaero mcp` subcommand. Everything below uses
> `quaero-mcp`.

## Security model (read this first)

The server is designed to expose *nothing* until you deliberately opt in, and to
refuse writes unless you deliberately allow them:

- **Opt-in per connection.** A connection is invisible to MCP unless it has
  `"mcp": true`. A plain connections export exposes nothing.
- **Read-only by default.** Unless a connection has `"mcpWrite": true`, every
  statement is vetted by a fail-closed [statement classifier](#statement-classifier)
  and anything that is not provably read-only (`SELECT` / read-only `WITH …` /
  `EXPLAIN` / `SHOW` / `DESCRIBE` / `VALUES`) is refused.
- **No credentials leave the process.** `list_connections` returns only
  `id`, `name`, `driver` and `readOnly`. Passwords are never returned and never
  logged.

## Setup with Claude Code

1. **Build the binary** (bundled with releases; from source it is
   `build/tools/quaero-mcp/quaero-mcp[.exe]`, produced by the default
   `-DQUAERO_BUILD_TOOLS=ON`).

2. **Create a connections file** (see [format](#connections-file)). The easiest
   start is *Exportar conexiones* in the app (issue #188), then add the `mcp` /
   `mcpWrite` flags to the connections you want to expose. Passwords are omitted
   from exports by default — add them back for engines that need them.

3. **Register the server:**

   ```sh
   claude mcp add quaero -- /path/to/quaero-mcp \
     --connections /path/to/connections.json \
     --drivers /path/to/drivers
   ```

   On Windows, point at `quaero-mcp.exe` and the installed `drivers` directory,
   e.g. `C:\Program Files\Quaero\quaero-mcp.exe` and `C:\Program Files\Quaero\drivers`.

   `--drivers` may be omitted; the server then looks for a `drivers` directory
   next to the executable. `--connections` may also be supplied via the
   `QUAERO_MCP_CONNECTIONS` environment variable (and `--drivers` via
   `QUAERO_MCP_DRIVERS`).

4. In Claude Code the four tools below appear under the `quaero` server.

## Tools

| Tool | Arguments | Purpose |
|------|-----------|---------|
| `list_connections` | — | List MCP-enabled connections (`id`, `name`, `driver`, `readOnly`). No credentials. |
| `schema_tree` | `connection` (req), `db?`, `schema?` | Browse databases / schemas / tables / views. |
| `schema_describe` | `connection` (req), `table` (req), `schema?` | Columns, types, nullability, primary key. |
| `query_run` | `connection` (req), `sql` (req), `limit?` | Run SQL. Writes refused on read-only connections. `limit` defaults to 200. |

`connection` accepts either the connection `id` or its `name`. Tool errors are
returned honestly as MCP tool results with `isError: true` and a message; they
never fake success.

## Connections file

Same versioned shape the app exports (issue #188), plus two per-connection
flags. `params` is the DSN passed verbatim to the driver.

```json
{
  "version": 1,
  "connections": [
    {
      "id": "analytics-ro",
      "name": "Analytics (read-only)",
      "driver": "mysql",
      "params": { "host": "db.internal", "port": "3306", "user": "reader",
                  "password": "…", "database": "analytics" },
      "mcp": true
    },
    {
      "id": "scratch",
      "name": "Scratch",
      "driver": "sqlite",
      "params": { "path": "C:/data/scratch.db" },
      "mcp": true,
      "mcpWrite": true
    }
  ]
}
```

- `"mcp"` (default `false`) — expose this connection to MCP at all.
- `"mcpWrite"` (default `false`) — allow non-read statements. Leave it off unless
  you truly want the model to be able to modify data.

Connections without a `driver` + `params` object, or without `"mcp": true`, are
silently skipped.

## Statement classifier

The read-only gate never executes anything to decide; it classifies the SQL
text with a pure, fail-closed classifier (`tools/quaero-mcp/stmt_class.c`,
unit-tested in `stmt_class_test`). It defends against the usual tricks:

- line (`--`) and block (`/* … */`) comments,
- keywords or `;` separators hidden inside string/identifier literals, under
  **both** quote-escape conventions (`''` doubling and `\'` backslash-escaping —
  it classifies under each and combines them fail-closed),
- data-modifying CTEs (`WITH d AS (DELETE … RETURNING *) SELECT * FROM d`),
- multi-statement payloads (`SELECT 1; DROP TABLE t`).

Anything it cannot prove read-only is treated as a write and refused on a
read-only connection.

## Local verification

The whole subsystem builds and is testable without a network or CI (core +
SQLite compile locally; no drivers are modified):

```sh
cmake -S . -B build
cmake --build build --target quaero-mcp stmt_class_test mcp_conns_test
ctest --test-dir build -R "stmt_class_test|mcp_conns_test" --output-on-failure
```

For an end-to-end check, drive it over stdio against a SQLite database — see
`scripts/smoke/mcp.mjs`, which opens a read-only and a writable connection to the
same file and asserts that reads pass, writes pass only on the writable one, and
`DROP` / multi-statement payloads are refused on the read-only one.
