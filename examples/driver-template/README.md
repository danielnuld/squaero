# Quaero driver template

The smallest driver that satisfies the [Quaero driver ABI](../../docs/DRIVER_API.md).
Copy this folder as the starting point for a real driver.

It talks to no database engine: it serves one fixed in-memory table so it
compiles with **zero external dependencies** and shows the required read path
working end to end.

```
id | name
---+--------
 1 | alice
 2 | (NULL)
```

## Layout

```
driver-template/
  CMakeLists.txt     builds a shared MODULE against the driver SDK
  src/
    internal.h       connection/result shapes + function prototypes
    driver.c         the required vtable members (replace the canned data)
    entry.c          wires the vtable and exports dbc_driver_entry
```

## Build it standalone

First install the driver SDK from the Quaero source tree:

```sh
cmake -S . -B build            # in the Quaero repo root
cmake --install build --prefix ~/quaero-sdk --component ...   # or a full install
```

Then build this template against it:

```sh
cmake -S examples/driver-template -B build-template \
      -DCMAKE_PREFIX_PATH=~/quaero-sdk
cmake --build build-template
```

The output is `example.so` / `example.dll` / `example.dylib`. Drop it in the
app's `drivers/` directory next to `quaero` and it loads as the driver named
`example`.

Built in-tree (as part of the main Quaero build), the same target is compiled
under the project's strict warnings — no separate install needed.

## Turn it into a real driver

1. **Rename** everything `example` → your engine id (`name` in `entry.c` is what
   `conn.open` selects).
2. **Connect for real.** In `driver.c`, parse the JSON DSN (`drivers/sqlite`
   uses the vendored cJSON) and open the engine connection in `example_connect`;
   store the engine handle in `struct dbc_conn`.
3. **Execute for real.** Run the SQL in `example_query` and walk the engine
   cursor in `next_row`/`cell_text`; map engine types to `dbc_type` in
   `col_type`.
4. **Add capabilities one at a time.** Implement an optional group
   (introspection, transactions, DDL, DML), then — and only then — set its
   `DBC_FEAT_*` bit in `entry.c`. Never advertise a capability a real handler
   does not back.

See [`docs/DRIVER_API.md`](../../docs/DRIVER_API.md) for the full contract and the
SQLite reference driver (`drivers/sqlite`) for a complete, minimal implementation
of every capability.
