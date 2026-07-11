# Hand-authored libpq build inputs (i686 MinGW)

These headers let `cmake/QuaeroLibpq.cmake` compile a static **libpq** from the
PostgreSQL source for the 32-bit Windows build, where no prebuilt 32-bit libpq is
available (the app must be x86 for the Informix CSDK). They stand in for the
files PostgreSQL's own `configure`/Meson would generate or that this MinGW
sysroot does not ship. Used **only** when building with `-DQUAERO_LIBPQ=ON`.

## Config headers (this directory)

- `pg_config.h` — the values `configure` would compute for `i686-w64-mingw32`
  (UCRT): data sizes/alignment for ILP32, little-endian, `long long` 64-bit, no
  `__int128`, portable slicing-by-8 CRC, SCRAM via libpq's built-in SHA-2 (no
  OpenSSL → no TLS, mirroring the MariaDB x86 decision). Version-stamped to match
  the `REL_16_9` tag fetched by `QuaeroLibpq.cmake` — bump both together.
- `pg_config_os.h` — selects the platform port header (`port/win32.h`).
- `pg_config_ext.h` — `PG_INT64_TYPE` (`long long int`).
- `pg_config_paths.h` — install-path macros; empty (a client can still point at a
  service file via `PGSYSCONFDIR`/`PGSERVICEFILE`).

## Socket shims (`shims/`)

This winlibs MinGW sysroot ships the Windows winsock headers but not the POSIX
`netdb.h` / `sys/socket.h` / `sys/un.h` / `netinet/*` / `arpa/inet.h` that
PostgreSQL's frontend sources include unconditionally. Each shim re-exports
`winsock2.h` / `ws2tcpip.h` (already pulled in by `port/win32.h`), and
`sys/un.h` provides a minimal `struct sockaddr_un` for the (unused) Unix-socket
code path. They are on the include path **only** for the libpq compile, not the
driver.

## Maintenance

When bumping the PostgreSQL tag in `cmake/QuaeroLibpq.cmake`, re-check the source
lists there and the version stamp in `pg_config.h`. `kwlist_d.h` is generated at
build time by the bundled Perl script, not stored here.
