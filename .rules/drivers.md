# Driver Rules

A driver is a plugin (`.dll`/`.so`/`.dylib`) implementing the vtable in
[`docs/DRIVER_API.md`](../docs/DRIVER_API.md). See the `quaero-driver` skill for
the full build playbook.

1. **Implement the contract honestly.** Advertise a capability in `features`
   **only** if a working handler backs it. Unsupported operations return
   `DBC_ERR_UNSUPPORTED` — never a fake empty success.
2. **Modular layout.** Keep the entry/dispatch thin; split logic:
   - `connection.c` — connect/disconnect, DSN parsing, error reporting
   - `query.c` — execute, result-set iteration, rows_affected
   - `metadata.c` — databases/schemas/tables/columns/indexes/FKs/views
   - `ddl.c` — DDL generation
   - `utils/` — identifier quoting, value formatting, type mapping, pagination
3. **Neutral types.** Map engine types to `dbc_type` in the driver; the core and
   UI never see engine-specific type codes.
4. **ABI discipline.** Verify `abi_version` on entry. A vtable change is an ABI
   change — coordinate via an issue and bump the version.
5. **Proprietary clients stay separate.** Oracle (OCI) and similar
   non-redistributable clients are built as standalone plugins loaded at
   runtime — never linked into the GPL core. (Informix no longer needs one: it
   speaks DRDA through libdrda, Apache-2.0, issue #557.)
6. **Tests (mandatory):** identifier quoting, SQL builders, type normalization,
   pagination, value serialization. Plus one JSON/stdio-style smoke of a real
   query against the engine where feasible.
7. **Reference driver:** SQLite is the canonical template — copy its structure.
