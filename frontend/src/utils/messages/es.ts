// Spanish message catalog — the BASE locale and single source of truth for the
// set of keys (issue: i18n / English support). Every user-facing string moves
// here under a dot-namespaced key; `en.ts` mirrors these keys. A missing key in
// another locale falls back to this catalog, then to the key itself.
//
// This catalog grows one UI area at a time (see docs and the i18n sweep). Keep
// keys sorted by namespace so ES and EN stay easy to diff.

export const es: Record<string, string> = {
  // common
  "common.settings": "Ajustes",
  "common.language": "Idioma",
  "common.cancel": "Cancelar",
  "common.edit": "Editar",
  "common.delete": "Eliminar",

  // connection bar / manager
  "conn.title": "Conexiones",
  "conn.choose": "Elegir conexión",
  "conn.statusConnected": "conectado",
  "conn.connectedDot": "Conectada",
  "conn.connect": "Conectar",
  "conn.focus": "Enfocar",
  "conn.connecting": "conectando…",
  "conn.disconnect": "Desconectar",
  "conn.reconnect": "Reconectar",
  "conn.new": "Nueva conexión",
  "conn.export": "Exportar",
  "conn.import": "Importar",
  "conn.includePasswords": "Incluir contraseñas",
  "conn.plaintextWarn": "⚠ El archivo guardará las contraseñas en <strong>texto plano</strong>.",
  "conn.empty": "No hay conexiones guardadas.",

  // language names — shown as endonyms (their own language) in every locale.
  "lang.es": "Español",
  "lang.en": "English",

  // status bar
  "status.noConnection": "Sin conexión",
  "status.rowsOne": "{n} fila",
  "status.rowsOther": "{n} filas",
  "status.scopeTitle": "Alcance de la última ejecución",
  "status.durationTitle": "Duración de la última ejecución",
  "status.shortcuts": "Atajos de teclado",

  // run scope indicator (issue #130)
  "scope.selection": "selección",
  "scope.statement": "sentencia",
  "scope.document": "documento",

  // theme toggle / settings
  "theme.light": "Tema: claro",
  "theme.dark": "Tema: oscuro",
  "theme.system": "Tema: sistema",
};
