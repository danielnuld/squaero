// English message catalog. Mirrors the keys in `es.ts` (the base locale). A key
// missing here falls back to the Spanish string, then to the key itself, so the
// app never shows a blank — untranslated areas simply appear in Spanish until
// their key lands here.

export const en: Record<string, string> = {
  // common
  "common.settings": "Settings",
  "common.language": "Language",
  "common.cancel": "Cancel",
  "common.edit": "Edit",
  "common.delete": "Delete",

  // connection bar / manager
  "conn.title": "Connections",
  "conn.choose": "Choose connection",
  "conn.statusConnected": "connected",
  "conn.connectedDot": "Connected",
  "conn.connect": "Connect",
  "conn.focus": "Focus",
  "conn.connecting": "connecting…",
  "conn.disconnect": "Disconnect",
  "conn.reconnect": "Reconnect",
  "conn.new": "New connection",
  "conn.export": "Export",
  "conn.import": "Import",
  "conn.includePasswords": "Include passwords",
  "conn.plaintextWarn": "⚠ The file will store passwords in <strong>plain text</strong>.",
  "conn.empty": "No saved connections.",

  // top action ribbon
  "toolbar.actions": "Actions",
  "toolbar.newQuery.label": "Query",
  "toolbar.newQuery.title": "New query",
  "toolbar.newTable.label": "Table",
  "toolbar.newTable.title": "New table",
  "toolbar.objects.label": "Objects",
  "toolbar.objects.title": "Object list of the active database",

  // tools (ribbon + object-tree tools menu + palette)
  "tool.monitor.label": "Server monitor",
  "tool.monitor.tab": "Server monitor",
  "tool.monitor.title": "Server monitor and process list",
  "tool.slow.label": "Slow queries",
  "tool.slow.tab": "Slow queries",
  "tool.slow.title": "Slowest queries recorded by the server",
  "tool.users.label": "Users and privileges",
  "tool.users.tab": "Users and privileges",
  "tool.users.title": "Users and privileges",
  "tool.er.label": "ER diagram",
  "tool.er.tab": "ER diagram",
  "tool.er.title": "Entity-relationship diagram",
  "tool.qb.label": "Query builder",
  "tool.qb.tab": "Builder",
  "tool.qb.title": "Visual query builder",
  "tool.routines.label": "Procedures and functions",
  "tool.routines.tab": "Procedures",
  "tool.routines.title": "Stored procedures and functions",
  "tool.triggers.label": "Triggers and events",
  "tool.triggers.tab": "Triggers and events",
  "tool.triggers.title": "Triggers and scheduled events",
  "tool.notebook.label": "SQL notebook",
  "tool.notebook.tab": "Notebook",
  "tool.notebook.title": "Notebook: SQL and Markdown cells with inline results",

  // language names — endonyms, same in every locale.
  "lang.es": "Español",
  "lang.en": "English",

  // status bar
  "status.noConnection": "Not connected",
  "status.rowsOne": "{n} row",
  "status.rowsOther": "{n} rows",
  "status.scopeTitle": "Scope of the last run",
  "status.durationTitle": "Duration of the last run",
  "status.shortcuts": "Keyboard shortcuts",

  // run scope indicator
  "scope.selection": "selection",
  "scope.statement": "statement",
  "scope.document": "document",

  // theme toggle / settings
  "theme.light": "Theme: light",
  "theme.dark": "Theme: dark",
  "theme.system": "Theme: system",
};
