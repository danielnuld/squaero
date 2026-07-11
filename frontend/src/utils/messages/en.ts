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
