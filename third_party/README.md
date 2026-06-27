# third_party

Vendored third-party code. Each dependency keeps its own license file.

| Library | Version | License | Used by |
|---|---|---|---|
| [cJSON](https://github.com/DaveGamble/cJSON) | v1.7.18 | MIT (`cjson/LICENSE`) | `libdbcore` IPC (JSON parsing) — internal only |

MIT is compatible with the project's GPLv3. cJSON is an implementation detail of
`libdbcore` and is never exposed through a public Quaero header.
