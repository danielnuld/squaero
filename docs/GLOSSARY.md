# UI glossary

One term per concept, in both languages, for every label, tooltip, message and
empty state in Squaero (#695). The message catalogs (`frontend/src/utils/messages/es.ts`,
`en.ts`) follow this file; `frontend/tests/utils/messages.test.ts` flags the
rejected variants and the tone rules that can be checked mechanically.

## Tone

- Tool voice: direct, concise, impersonal. Say what happens or what to do; no
  marketing, no filler ("simplemente", "fácilmente", "potente", "simply",
  "easily", "powerful"), no cheering ("¡Listo!", "Ups", "Oops").
- No exclamation marks, no decorative emoji or glyphs in text (▶, 📊, ⚠). An
  icon is a component, not a character in a label.
- Sentence case everywhere, in both languages ("Monitor de servidor", "Server
  monitor"). No Title Case, no ALL CAPS in text (upper-casing is CSS). Proper
  nouns and SQL keywords keep their own case (Face ID, PostgreSQL, NULL, INSERT).
- Ellipsis ("…", one character, never "...") only on a command that needs more
  input before it completes: a file dialog, a confirmation, a wizard, a target
  to choose ("Examinar…", "Respaldar…", "Eliminar…", "Importar datos…").
  Commands that just open a panel or a tab have no ellipsis ("Ver definición",
  "Modificar tabla"). Placeholders have no trailing ellipsis ("Buscar usuario").
  A progress state keeps it ("Cargando…", "Ejecutando…").
- Quotes around a name: «…» in Spanish, “…” in English. Never straight quotes.
- Errors: `No se pudo <verbo>: {detalle}` / `Could not <verb>: {detail}`.
  Never a fake success for an unsupported operation: say which engine lacks it.
- Spanish: "solo" without accent; "aún" rather than "todavía"; second person
  ("Reconecta", "Elige") for instructions, impersonal for states.
- English: US spelling (color, canceled, license).

## Terms

| Concept | es | en | Rejected |
|---|---|---|---|
| A saved server/file definition | conexión | connection | — |
| Act of opening it | conectar / reconectar / desconectar | connect / reconnect / disconnect | abrir conexión |
| SQL text the user runs | consulta | query | sentencia (reserved for *statement*) |
| One SQL statement inside a script | sentencia | statement | comando |
| Run SQL | ejecutar | run | correr, lanzar; execute (en) |
| Count of runs (noun) | ejecuciones | executions | runs |
| Editor/results container | pestaña | tab | ficha |
| What a query returns | resultado | result | — |
| The results table widget | rejilla | grid | tabla (reserved for the DB object) |
| DB object | tabla / vista | table / view | — |
| Namespace in the engine (PostgreSQL, SQL Server) and the database as a whole | esquema | schema | — |
| One object's definition (columns, indexes, DDL) | estructura | structure | esquema |
| Engine namespace / catalog | base de datos (always in full) | database | base, BD, DB |
| DB engine (MySQL, SQLite…) | motor | engine | gestor, driver (internal only) |
| Machine field in a connection form | host | host | — |
| The machine, in prose | servidor | server | — |
| Row / column | fila / columna | row / column | registro, record; campo, field |
| Primary / foreign key | clave primaria / clave foránea | primary key / foreign key | llave |
| Stored routines | procedimientos y funciones | procedures and functions | rutinas, routines |
| Triggers and scheduled events | triggers y eventos | triggers and events | disparadores |
| Index / constraint | índice / constraint | index / constraint | restricción |
| Saved query | snippet | snippet | fragmento, favorito, favourite |
| Pending change in the grid | sin guardar | unsaved | — |
| Commit the open transaction | confirmar | confirm | aplicar, commit |
| Run a set of changes/statements (DDL designer, sync, filter) | aplicar | apply | — |
| Persist (snippet, file, connection, pending rows) | guardar | save | — |
| Throw away pending changes | descartar | discard | cancelar |
| Reverse the last action | deshacer | undo | revertir |
| Abort a dialog | cancelar | cancel | — |
| Destroy an object/row/user on the server | eliminar | delete | borrar, drop, quitar |
| Take out of a list without destroying (condition, column in the designer, new unsaved row, filter) | quitar | remove | eliminar |
| Add to a list | añadir | add | agregar |
| Reload what a panel shows | refrescar | refresh | actualizar, recargar |
| New software version | actualización / actualizar | update | — |
| Choose a value among options | elegir | choose | escoger, pick, seleccionar |
| Select an item in a list to act on it | seleccionar | select | elegir |
| Tick rows in the grid for a bulk action | marcar / desmarcar | mark / unmark | seleccionar |
| Sort | ordenar / orden | sort | order by (SQL only) |
| Filter | filtrar / filtro | filter | — |
| Search in a list or palette | buscar | search | find |
| Find text in the editor (Ctrl+F) | buscar | find | search |
| Export / import | exportar / importar | export / import | — |
| Database dump to a file | respaldar / respaldo | back up / backup | volcar, dump |
| Restore from a dump | restaurar | restore | — |
| Copy to another database | transferir | transfer | copiar |
| Make two sides match | sincronizar | sync | — |
| What a user may do | permiso | privilege | privilegio |
| Preview before applying | vista previa | preview | — |
| Default value/option | por defecto | default | predeterminado |
| Server-side session | sesión | session | proceso |
| End a server session (SQL KILL) | matar sesión | kill session | terminar |
| Modify a table's definition | modificar | alter | alterar, editar |
| Change text/definition/connection | editar | edit | modificar |
| Table/view data opened in a tab | abrir datos | open data | ver datos |
| A saved connection's guard against writes (setting) | protección | protection | — («modo seguro» / safe mode only in code and docs) |
| Its two levels | solo lectura / confirmar escrituras | read-only / confirm writes | — |
| A connection with either level on | conexión protegida | protected connection | — |
| Editor mode where writes wait for Commit/Rollback | transacción manual | manual transaction | — |
| Its opposite, each statement commits on its own | auto-commit | auto-commit | — |
| Periodic probe of an idle connection | keep-alive | keep-alive | — |
| Result kept aside so the next run does not replace it | resultado fijado / fijar / quitar | pinned result / pin / unpin | — |
| Rows shown with the columns as rows | transponer / vista transpuesta | transpose / transposed view | — |
| Saved versions of what a tab's editor held | historial local | local history | — |
| Metadata shown before the server answers | desde caché | from cache | — |
| SQL that makes one schema match another | script de migración | migration script | — |
| A built-in look of the whole app (B · Nativo, A · Quiet pro, C · Editorial, Rosa pastel) | estilo | style | tema (reserved for the color sets under «Otros temas») |
| A set of colors, built in or imported | tema | theme | estilo |
| Not supported by this engine | no disponible para este motor | not available for this engine | no soportado (only for the core's own error) |

## Reserved words that stay as-is

SQL keywords and engine terms are not translated: NULL, INSERT, SELECT, EXPLAIN,
ORDER BY, DDL, PK, AI, TLS, SSL, SSH, CA, TOFU, DRDA, SQLI, onmode, pg_cron.
