# third_party

Vendored third-party code. Each dependency keeps its own license file.

| Library | Version | License | Used by |
|---|---|---|---|
| [cJSON](https://github.com/DaveGamble/cJSON) | v1.7.18 | MIT (`cjson/LICENSE`) | `libdbcore` IPC (JSON parsing) — internal only |
| [SQLite](https://www.sqlite.org) | 3.46.1 | Public domain (`sqlite/README.md`) | `drivers/sqlite` reference driver |

MIT is compatible with the project's GPLv3. cJSON is an implementation detail of
`libdbcore` and is never exposed through a public Quaero header. SQLite is public
domain; it is linked only into the SQLite driver plugin, not into the core.
