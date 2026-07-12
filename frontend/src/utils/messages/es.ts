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

  // top action ribbon
  "toolbar.actions": "Acciones",
  "toolbar.newQuery.label": "Consulta",
  "toolbar.newQuery.title": "Nueva consulta",
  "toolbar.newTable.label": "Tabla",
  "toolbar.newTable.title": "Nueva tabla",
  "toolbar.objects.label": "Objetos",
  "toolbar.objects.title": "Lista de objetos de la base activa",

  // tools (ribbon + object-tree tools menu + palette)
  "tool.monitor.label": "Monitor de servidor",
  "tool.monitor.tab": "Monitor de servidor",
  "tool.monitor.title": "Monitor de servidor y lista de procesos",
  "tool.slow.label": "Consultas lentas",
  "tool.slow.tab": "Consultas lentas",
  "tool.slow.title": "Consultas más lentas registradas por el servidor",
  "tool.users.label": "Usuarios y permisos",
  "tool.users.tab": "Usuarios y permisos",
  "tool.users.title": "Usuarios y permisos",
  "tool.er.label": "Diagrama ER",
  "tool.er.tab": "Diagrama ER",
  "tool.er.title": "Diagrama entidad-relación",
  "tool.qb.label": "Constructor de consultas",
  "tool.qb.tab": "Constructor",
  "tool.qb.title": "Constructor visual de consultas",
  "tool.routines.label": "Procedimientos y funciones",
  "tool.routines.tab": "Procedimientos",
  "tool.routines.title": "Procedimientos almacenados y funciones",
  "tool.triggers.label": "Triggers y eventos",
  "tool.triggers.tab": "Triggers y eventos",
  "tool.triggers.title": "Triggers y eventos programados",
  "tool.notebook.label": "Notebook SQL",
  "tool.notebook.tab": "Notebook",
  "tool.notebook.title": "Notebook: celdas de SQL y Markdown con resultados en línea",

  // SQL editor + its toolbar
  "editor.run": "Ejecutar",
  "editor.runSelection": "Ejecutar selección",
  "editor.runTitle": "Ejecutar (Ctrl/Cmd+Enter)",
  "editor.runSelectionTitle": "Ejecutar la selección (Ctrl/Cmd+Enter)",
  "editor.format": "Formatear",
  "editor.formatTitle": "Formatear SQL (Ctrl/Cmd+Shift+F)",
  "editor.plan": "Plan",
  "editor.planTitle": "Ver plan de ejecución — EXPLAIN (Ctrl/Cmd+Shift+E)",
  "editor.history": "Historial",
  "editor.historyTitle": "Historial de consultas",
  "editor.snippets": "Snippets",
  "editor.snippetsTitle": "Favoritos y snippets",
  "editor.runHint": "Ctrl/Cmd + Enter para ejecutar",
  "editor.selectAll": "Seleccionar todo",
  "editor.copy": "Copiar",

  // editor empty state (issue #178)
  "empty.lead": "Ejecuta una consulta para ver resultados.",
  "empty.recentTables": "Tablas recientes",
  "empty.openTable": "Abrir {name}",
  "empty.recentQueries": "Consultas recientes",
  "empty.rerunNewTab": "Reejecutar en una pestaña nueva",
  "empty.insertSnippet": "Insertar en el editor",
  "empty.shortcuts": "Atajos",
  "empty.hint": "Abre una tabla del árbol o escribe SQL y pulsa {keys}.",

  // tab titles (showTool / new-query tabs in App.tsx) + palette object hints
  "tab.explainPlan": "Plan de ejecución",
  "tab.import": "Importar · {name}",
  "tab.generate": "Generar · {name}",
  "tab.schemaSync": "Sincronizar esquema",
  "tab.dataSync": "Sincronizar datos",
  "tab.transfer": "Transferir",
  "tab.chart": "Gráfico",
  "tab.structure": "Estructura · {name}",
  "tab.indexes": "Índices · {name}",
  "tab.alter": "Modificar · {name}",
  "tab.objectList": "Objetos · {db}",
  "tab.editConn": "Editar · {name}",
  "tab.viewHint": "vista",
  "tab.tableHint": "tabla",

  // object tree sidebar (ObjectTree.tsx + treeObjects.ts / tree.ts folder labels)
  "tree.tools": "Herramientas",
  "tree.refresh": "Refrescar",
  "tree.refreshTitle": "Refrescar (F5)",
  "tree.filterPlaceholder": "Filtrar objetos…",
  "tree.filterAria": "Filtrar objetos",
  "tree.clearFilter": "Limpiar filtro",
  "tree.loading": "Cargando…",
  "tree.noObjects": "Sin objetos.",
  "tree.connectHint": "Conecta para explorar el esquema.",
  "tree.viewDef": "Ver definición…",
  "tree.copyName": "Copiar nombre",
  "tree.openData": "Abrir datos",
  "tree.viewStructure": "Ver estructura",
  "tree.editDef": "Editar definición…",
  "tree.alterTable": "Modificar tabla…",
  "tree.indexes": "Índices y constraints…",
  "tree.importData": "Importar datos…",
  "tree.newTable": "Nueva tabla…",
  // folder labels (data keys, translated at the tree consumer)
  "tree.tables": "Tablas",
  "tree.views": "Vistas",
  "tree.procedures": "Procedimientos",
  "tree.functions": "Funciones",
  "tree.triggers": "Triggers",
  "tree.events": "Eventos",

  // object-action toolbar (ObjectToolbar.tsx)
  "objbar.aria": "Acciones del objeto",
  "objbar.readOnlyNoPk": "Solo lectura: la tabla no tiene clave primaria.",
  "objbar.import": "Importar",
  "objbar.generate": "Generar datos",
  "objbar.syncTitle": "Sincronizar estructura o datos con otra base",
  "objbar.sync": "Sincronizar",
  "objbar.syncSchema": "Estructura (esquema)…",
  "objbar.syncData": "Datos…",
  "objbar.transfer": "Transferir",
  "objbar.addRow": "Fila",
  "objbar.confirm": "Confirmar ({n})",
  "objbar.discard": "Descartar",
  "objbar.chart": "Graficar",
  "objbar.exportTitle": "Exportar el resultado",
  "objbar.export": "Exportar",

  // result pane: edit preview, pagination bar, cell context menu (App.tsx)
  "result.confirmChanges": "Confirmar cambios",
  "result.willRun": "Se ejecutarán {n} sentencia(s) en la transacción abierta.",
  "result.applyConfirm": "Aplicar y confirmar",
  "result.prev": "‹ Anterior",
  "result.next": "Siguiente ›",
  "result.rowsRange": "Filas {from}–{to}",
  "result.pagingPaused": " · paginación en pausa durante la edición",
  "result.rowDetail": "Ver detalle de fila",
  "result.copyCell": "Copiar celda",
  "result.copyRow": "Copiar fila",
  "result.copyRowJson": "Copiar fila como JSON",
  "result.exportFmt": "Exportar {fmt}",

  // result grid (ResultGrid.tsx)
  "grid.rowsAffected": "{n} fila(s) afectada(s).",
  "grid.sort": "Ordenar (asc / desc / ninguno)",
  "grid.resize": "Ajustar ancho de columna",
  "grid.filterPlaceholder": "Filtrar…",
  "grid.filterBy": "Filtrar por {name}",
  "grid.undoDelete": "Deshacer borrado",
  "grid.deleteRow": "Borrar fila",
  "grid.newRows": "Nuevas filas",
  "grid.removeNewRow": "Quitar fila nueva",
  "grid.noFilterMatch": "Ninguna fila de la página coincide con el filtro.",
  "grid.truncated": "Mostrando las primeras {n} filas (resultado truncado). El orden y los filtros se aplican solo sobre las filas cargadas, no con ORDER BY/WHERE en el servidor.",
  "grid.runToSee": "Ejecuta una consulta para ver resultados.",
  "grid.running": "Ejecutando…",

  // errors
  "error.noActiveConn": "No hay conexión activa. Abre una conexión para ejecutar consultas.",

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
