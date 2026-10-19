# Auditoría UI/UX: interfaz actual de Squaero

Alcance: la interfaz actual tal como sale en las 106 capturas (1280×800, `screens/*.png`), en `inventory.md` y `tokens.md`, con comprobaciones puntuales en `frontend/src`. Revisé 50 capturas una a una, de todas las áreas.
Referencias: Windows/Fluent (escritorio Win32), macOS HIG, GNOME HIG, WCAG 2.2 AA, las 10 heurísticas de Nielsen y las convenciones de DataGrip, DBeaver, TablePlus, Navicat, SSMS y Postico.

**Resumen:** 42 hallazgos: 2 críticos, 9 altos, 19 medios y 12 bajos.

| Severidad | Nº | IDs |
|---|---|---|
| Crítica | 2 | A-01, A-02 |
| Alta | 9 | A-03 … A-11 |
| Media | 19 | A-12 … A-30 |
| Baja | 12 | A-31 … A-42 |

---

## Críticas

### A-01 · Sincronizar datos: DELETE/UPDATE sobre un destino calculados con una página y aplicados sin confirmación
- **Área:** Herramientas / sincronización de datos
- **Severidad:** Crítica
- **Problema:** `data-diff-result.png` dice «ORIGEN: 12 FILA(S) CARGADA(S)» y «3 operación(es) para igualar el destino». El código (`DataDiffWizard.tsx`, comentario de cabecera) aclara que el diff genera INSERT/UPDATE/**DELETE** y que está «acotado a las filas cargadas en cada lado». Con una tabla de 50 000 filas y una página de 1000, el plan «igualar el destino» borraría o pisaría filas reales del destino. El botón primario «Aplicar (3)» ejecuta sin ConfirmDialog: solo pasa por `withWriteConsent` cuando el destino es una conexión protegida. Además, los literales van entrecomillados como texto aunque la columna sea numérica (`"saldo" = '980.5'`, `"id" = '2'`).
- **Incumple:** Nielsen n.º 5 (prevención de errores) y n.º 1 (visibilidad del estado). Las herramientas de Data Compare/Sync de DataGrip, Navicat y SSMS comparan la tabla completa por clave y piden confirmación con el resumen por tipo de operación y el destino.
- **Impacto:** pérdida silenciosa de datos en otra base, que muchas veces es la de producción.
- **Recomendación:** (1) Comparar la tabla completa por PK, por bloques y con progreso y Cancelar. Si de momento no es posible, no generar DELETE fuera del rango comparado y titular la pantalla «Comparar las N filas cargadas» en vez de «igualar el destino». (2) Antes de aplicar, abrir un ConfirmDialog con el texto «Vas a modificar *Ventas copia › main.clientes*: 1 INSERT · 2 UPDATE · 0 DELETE» y un botón destructivo con texto explícito («Aplicar 3 cambios en Ventas copia»). (3) Generar literales tipados según el tipo de la columna.

### A-02 · Eliminar una conexión guardada no pide confirmación, no se puede deshacer y desconecta la sesión viva
- **Área:** Gestión de conexiones
- **Severidad:** Crítica
- **Problema:** en `connection-manager.png`, el 🗑 (unos 10 px, en un rosa casi transparente) está pegado al ✎. `App.tsx` → `onDeleteConnection` persiste el borrado al instante y, si la conexión está abierta, llama a `disconnect`. No hay diálogo, toast con «Deshacer» ni papelera (el inventario, §7, lo confirma: «deletes immediately, no confirm»).
- **Incumple:** Nielsen n.º 3 (control y libertad) y n.º 5. Fluent y GNOME HIG piden confirmar o permitir deshacer en acciones destructivas. WCAG 2.5.8 (tamaño de objetivo).
- **Impacto:** un clic mal dado borra host, usuario, contraseña, túnel SSH y protección de una conexión, y además corta la sesión en curso.
- **Recomendación:** toast «Conexión "X" eliminada · Deshacer» de 8–10 s, o ConfirmDialog cuando la conexión está abierta o tiene contraseña guardada. Separar el borrado del ✎ y moverlo al menú contextual de la fila («Eliminar…» en rojo y al final). Objetivo mínimo de 24×24.

---

## Altas

### A-03 · La barra de acciones del objeto se rompe: una palabra por línea, rótulos en dos líneas y botones fuera de pantalla
- **Área:** Rejilla de datos / barra de herramientas
- **Severidad:** Alta
- **Problema:** en `view-data.png`, el aviso «Solo lectura: la tabla no tiene clave primaria…» se parte palabra por palabra y la barra crece hasta unos 280 px, lo que empuja la rejilla hacia abajo. En `data-grid.png`, a 1280 px, el último botón («↥ Exportar») queda cortado en el borde derecho. En `export-menu.png` la barra provoca scroll horizontal y «Refrescar» desaparece por la izquierda. «Generar datos» y «Comparar con…» ocupan dos líneas, así que los botones tienen alturas distintas (Plan/Historial: 24 px; Generar: 52 px).
- **Incumple:** la barra de comandos de Fluent (desbordamiento en un menú «…» con prioridades) y GNOME HIG (header bars con overflow). Nielsen n.º 8 (diseño minimalista).
- **Impacto:** acciones que no se encuentran (Exportar), una rejilla que salta según el estado y una sensación general de interfaz rota.
- **Recomendación:** una sola fila con altura fija de 32 px, botones de icono + texto en horizontal y `white-space: nowrap`, y un menú de desbordamiento «⋯» que vaya absorbiendo las acciones de menor prioridad. Sacar el aviso de solo lectura de la barra: un chip «🔒 Solo lectura» con el motivo en un tooltip o popover, o una franja informativa encima de la rejilla.

### A-04 · En modo edición no se marca qué celdas se han cambiado
- **Área:** Rejilla / edición
- **Severidad:** Alta
- **Problema:** en `grid-pending-changes.png` el botón dice «✓ Confirmar (1)», pero la celda editada (fila 2, «Ures») se ve igual que las demás. `styles.css` solo tiene `.row-deleted`; no existe un estilo de celda modificada, y `ResultGrid.tsx` sustituye el valor sin marcarlo.
- **Incumple:** la convención de DataGrip, DBeaver, SSMS, TablePlus y Navicat (celda modificada en otro color o con un marcador, y la fila marcada en el gutter). Nielsen n.º 1 y n.º 6 (reconocer antes que recordar).
- **Impacto:** el usuario confirma cambios que no ve. Con varias páginas o muchas columnas, la única forma de revisarlos es leer el SQL de la vista previa.
- **Recomendación:** clase `.cell-dirty` (fondo ámbar al 18 % + triángulo en la esquina), un marcador «●» en el número de fila y un tooltip con el valor original. Añadir «Revertir celda» y «Revertir fila» al menú contextual.

### A-05 · El filtro por columna filtra solo la página cargada y la barra de estado no se entera
- **Área:** Rejilla / filtrado
- **Severidad:** Alta
- **Problema:** en `grid-column-filter.png` el filtro «Hermo» deja 3 filas visibles, pero la barra de estado sigue diciendo «Filas 1–12 · 12 filas» y la barra de filtro, «todas las filas». El mensaje del inventario («Ninguna fila de **la página** coincide con el filtro») confirma que es un filtro local. Conviven dos sistemas de filtrado con aspecto parecido: la fila «Filtrar» (local) y «+ Condición» (WHERE en el servidor).
- **Incumple:** Nielsen n.º 1 y n.º 4 (consistencia). En DataGrip y TablePlus el filtro de la rejilla de una tabla es un WHERE en el servidor; DBeaver distingue con claridad «filtro de resultado» y «filtro de datos».
- **Impacto:** el usuario cree que «no hay más clientes de Hermosillo» cuando solo ha mirado las primeras 1000 filas.
- **Recomendación:** en pestañas de tabla, que el filtro de columna genere una condición de servidor (o aplicarlo sobre la página y mostrar un botón «Aplicar a toda la tabla»). Mostrar siempre «3 de 12 filas cargadas (filtro local)» en la barra de estado y resaltar las cabeceras con filtro activo (icono de embudo).

### A-06 · El autocompletado no ofrece tablas si el árbol no está desplegado
- **Área:** Editor SQL
- **Severidad:** Alta
- **Problema:** en `editor-autocomplete.png`, tras `SELECT * FROM cli` la lista solo muestra palabras clave (`cli`, `conflict`, `collation`, `exclusive`…) y no aparece `clientes`. En `App.tsx` `sqlSchema` se construye con `focusedObjects()`, es decir, con los nodos que el árbol ya ha cargado. Como el nodo `main` está plegado, el editor «no conoce» ninguna tabla.
- **Incumple:** lo que se espera de cualquier cliente maduro (DataGrip, DBeaver, SSMS IntelliSense): un autocompletado basado en el catálogo, independiente de la UI del árbol. Nielsen n.º 7 (flexibilidad y eficiencia).
- **Impacto:** el autocompletado parece roto justo en el caso más común (el nombre de una tabla después de FROM/JOIN).
- **Recomendación:** al conectar, o al cambiar de base activa, cargar en segundo plano la lista de tablas y vistas para el editor, sin depender de lo que esté desplegado. Ordenar primero los objetos del esquema y después las palabras clave, y distinguirlos con un icono por tipo.

### A-07 · Transacción manual: estado ambiguo, controles poco visibles y vocabulario confuso
- **Área:** Editor / transacciones
- **Severidad:** Alta
- **Problema:** en `tx-manual-pending.png`, «Transacción manual» aparece en gris claro y parece deshabilitado. «Confirmar» y «Revertir» son enlaces de texto sueltos dentro de una barra que se parte en dos líneas, y el único aviso persistente es «TX» a 11 px en la barra de conexiones y «En transacción · 1» en la barra de estado. El éxito del DML («1 fila(s) afectada(s).») se pinta en **rojo**. «Confirmar» significa COMMIT aquí, pero también es el título genérico de los diálogos y la opción de protección «Confirmar escrituras». En el diálogo de desconexión, «Revertir» es el botón destacado y «Confirmar» queda neutro. En `editor-dml-result.png` aparece «database is locked» sin ninguna pista de que la causa es una transacción abierta.
- **Incumple:** Nielsen n.º 1, n.º 2 (lenguaje del usuario) y n.º 4. Convención de DataGrip y DBeaver: un selector Auto/Manual visible con icono, Commit/Rollback como botones con icono, un contador de sentencias pendientes y un aviso al cerrar.
- **Impacto:** transacciones olvidadas que bloquean la base (o la tabla en servidor) y cambios que se pierden o se confirman por error.
- **Recomendación:** convertir el modo en un control segmentado «Auto | Manual» con estado claro. Cuando haya una transacción abierta, mostrar una franja ámbar persistente sobre los resultados: «Transacción abierta · 1 sentencia · [Commit] [Rollback]». Usar «Commit / Rollback» (o «Confirmar transacción / Deshacer transacción») y no «Confirmar» a secas. Pintar el éxito del DML en color neutro o verde. Si el error es de bloqueo, añadir «¿Hay una transacción abierta en otra pestaña?» con un enlace a ella.

### A-08 · Los errores de ejecución son una línea roja sin posición, contexto ni acciones
- **Área:** Editor / resultados
- **Severidad:** Alta
- **Problema:** `editor-error.png` muestra «La consulta falló al ejecutarse. (no such column: telefono)» en rojo monoespaciado. No hay línea ni columna, código o SQLSTATE, botón «Copiar» ni «Ir a la posición», y el toast «Falló a las…» desaparece a los 6 s. `editor-dml-result.png` muestra «(database is locked)» sin explicación. El subrayado ondulado del editor es lo único útil.
- **Incumple:** Nielsen n.º 9 (ayudar a reconocer, diagnosticar y recuperarse). Convención de SSMS (pestaña Mensajes con línea y enlace), DataGrip (error con posición, «Show in editor» y copiar) y DBeaver (panel de error con detalle).
- **Impacto:** se pierde tiempo localizando el fallo y, con scripts largos, no se sabe qué sentencia falló.
- **Recomendación:** un panel de error estructurado con título humano, mensaje del motor, código y SQLSTATE, la sentencia que falló (número en el script), un enlace «Ir a la línea N» que mueva el cursor y los botones «Copiar error» y «Buscar en el historial». Para errores frecuentes (bloqueo, columna inexistente con nombre parecido), añadir una sugerencia.

### A-09 · El plan de ejecución de SQLite solo muestra cajas «STEP», sin detalle y sin leyenda
- **Área:** Herramientas / EXPLAIN
- **Severidad:** Alta
- **Problema:** en `explain-plan.png` hay cuatro cajas: «QUERY PLAN» y tres «STEP», sin tabla, índice, filas ni coste. Dos de ellas tienen borde rojo («ruta cara») sin ninguna leyenda. Tampoco se ve qué consulta se está analizando ni hay una vista alternativa en texto o tabla.
- **Incumple:** Nielsen n.º 1 y n.º 10. Convención de DataGrip y DBeaver (plan en árbol más tabla con detalle por nodo) y de SSMS (tooltip por operador).
- **Impacto:** la función parece funcionar pero no aporta ninguna información, lo que resta confianza en el resto.
- **Recomendación:** usar la columna `detail` de `EXPLAIN QUERY PLAN` como texto del nodo («SCAN clientes», «SEARCH pedidos USING INDEX…»). Añadir un selector «Árbol | Tabla | Texto», una leyenda del color de coste y la consulta analizada arriba, con un enlace para volver a su pestaña.

### A-10 · Otras acciones irreversibles se ejecutan sin confirmar: limpiar historial, matar sesión, restaurar y transferir
- **Área:** Transversal / acciones destructivas
- **Severidad:** Alta
- **Problema:** `HistoryPanel` → «Limpiar historial» vacía el almacén directamente (`App.tsx` `clearHistory`). En `ServerMonitor.tsx`, «Matar sesión» llama a `kill` sin diálogo. En `BackupPanel.tsx`, «Restaurar» es un botón primario que ejecuta un .sql completo sobre la base activa («lo que ya se ejecutó queda aplicado», `backup-restore.png`). En `transfer-wizard-result.png`, «Transferir» inserta en otra conexión sin resumen previo. En cambio, DROP, índices, usuarios y la migración de estructura sí tienen ConfirmDialog.
- **Incumple:** Nielsen n.º 4 (la app confirma unas acciones destructivas y otras no) y n.º 5. DBeaver y SSMS confirman Kill y Restore.
- **Impacto:** cortar la sesión de otra persona, restaurar sobre la base equivocada, perder el historial.
- **Recomendación:** aplicar la misma norma a todo lo irreversible: ConfirmDialog que nombre la conexión y la base de destino («Restaurar *dump.sql* (214 sentencias) sobre *Ventas › main*») y un botón con el verbo concreto. Para el historial basta un toast con Deshacer.

### A-11 · El menú nativo no cumple las convenciones: no hay menú Editar estándar ni menú de app en macOS
- **Área:** Ventana / menús
- **Severidad:** Alta
- **Problema:** según el inventario, la barra de menús nativa solo existe en Windows y Linux. «Editar» contiene Buscar, Confirmar cambios, Guardar snippet y filtros, pero no Deshacer, Rehacer, Cortar, Copiar, Pegar ni Seleccionar todo. «Archivo» no tiene «Abrir .sql…», «Guardar .sql» ni «Nueva conexión…», que solo están en barras internas. «Ayuda» no tiene «Acerca de» ni enlaces. No hay atajo para Ajustes (Ctrl+, / ⌘,). En macOS falta el menú de aplicación (Acerca de, Ajustes ⌘,, Ocultar, Salir ⌘Q).
- **Incumple:** macOS HIG (menú de app y menú Edición obligatorios; en WKWebView, sin menú Edición dejan de funcionar ⌘C/⌘V/⌘Z en los campos), las pautas de menús de Windows (Archivo/Edición estándar) y GNOME HIG (menú principal con Atajos y Acerca de).
- **Impacto:** los usuarios de macOS pierden atajos básicos y en todas las plataformas hay que descubrir funciones esenciales en barras internas.
- **Recomendación:** generar menús por plataforma. En macOS: menú «Squaero» y Edición estándar con roles nativos. En Windows/Linux: Archivo con Nueva consulta, Nueva conexión…, Abrir…, Guardar, Guardar como…, Ajustes (Ctrl+,) y Salir; Editar con Deshacer, Rehacer, Cortar, Copiar, Pegar y Seleccionar todo antes de las acciones propias; Ayuda con Atajos, Documentación, Buscar actualizaciones y Acerca de.

---

## Medias

### A-12 · En modo edición la rejilla pierde la codificación de tipos y NULL se confunde con el texto «NULL»
- **Área:** Rejilla / edición
- **Severidad:** Media
- **Problema:** en `grid-edit-mode.png` desaparecen los colores por tipo y la etiqueta `NULL`. La celda `saldo` de la fila 3 muestra «NULL» en gris, igual que si fuera una cadena. Para poner NULL hay que pasar por el menú contextual («Poner NULL»).
- **Incumple:** la convención de DataGrip y DBeaver (`<null>` con su estilo propio en todo momento y Ctrl+Supr / Alt+Supr para poner NULL). Nielsen n.º 4.
- **Impacto:** se acaban guardando `'NULL'` como texto en lugar de NULL, o al revés.
- **Recomendación:** mantener la etiqueta NULL también en edición (placeholder estilizado y no editable hasta escribir). Añadir un atajo «Poner NULL» (p. ej. Ctrl+Mayús+N), mostrarlo en el menú contextual y conservar los colores por tipo.

### A-13 · La barra del editor no tiene jerarquía: «Ejecutar» parece un enlace, falta Detener y «Guardar» es ambiguo
- **Área:** Editor SQL
- **Severidad:** Media
- **Problema:** en `editor-result.png` hay nueve rótulos de texto planos: Ejecutar, Auto-commit, Formatear, Plan, Historial, ▾, Guardar, Snippets, Abrir .sql y Guardar .sql. «Ejecutar» solo se distingue por el color; no tiene icono ▶ ni forma de botón. La barra está entre el editor y los resultados (y no sobre el editor, como en DataGrip, DBeaver o SSMS) y se parte en dos líneas en `tx-manual-pending.png`. «Guardar» guarda un snippet, pero está junto a «Guardar .sql». No hay un botón Detener visible en la barra; solo hay Cancelar dentro de la rejilla mientras dura la ejecución.
- **Incumple:** Nielsen n.º 4 y n.º 8; Fluent (acción principal destacada). Convención de los clientes SQL: ▶ Ejecutar / ■ Detener junto al editor y selector de modo de transacción visible.
- **Impacto:** cuesta descubrir funciones y hay riesgo de guardar en el sitio equivocado.
- **Recomendación:** una barra superior con ▶ Ejecutar (botón con relleno), ■ Detener (activo durante la ejecución), un separador, Auto/Manual, Commit/Rollback, Formatear y Plan, más un menú «⋯» para Abrir/Guardar archivo, Historial y Snippets. Renombrar «Guardar» a «Guardar como snippet». Fijar la altura y llevar el desbordamiento a «⋯».

### A-14 · El menú contextual de celda tiene 23 entradas planas y lo más usado queda enterrado
- **Área:** Rejilla / menús
- **Severidad:** Media
- **Problema:** `grid-context-menu.png` ocupa casi todo el alto. «Copiar celda», la acción más frecuente, está en la posición 15. Hay seis «Exportar X» sueltos, cinco «Filtrar: nombre …» y ningún atajo visible a la derecha, aunque existen (Ctrl+C, Ctrl+D).
- **Incumple:** las pautas de menús contextuales de Windows y GNOME (pocos elementos, lo frecuente arriba, submenús para grupos, aceleradores visibles). Nielsen n.º 8.
- **Impacto:** el menú se lee despacio y los atajos no se aprenden.
- **Recomendación:** ordenar por frecuencia: Copiar (Ctrl+C), Copiar como ▸ (con encabezados, INSERT, JSON, CSV), Pegar, Poner NULL, Ver detalle de fila; luego un separador con Filtrar por este valor ▸ y Datos relacionados; luego Duplicar y Eliminar fila (Supr); y al final Exportar ▸. Mostrar el atajo de cada entrada.

### A-15 · La barra lateral duplica información y gasta unos 250 px antes del árbol
- **Área:** Barra lateral / conexiones
- **Severidad:** Media
- **Problema:** en `data-grid.png` la misma conexión aparece dos veces: como elemento de «CONEXIONES / 1 abierta» y como cabecera de sección «VENTAS (SQLITE)», con sus propios botones de desconectar (⏏ dos veces). Debajo viene el desplegable «BASE DE DATOS ACTIVA: main» y después el nodo raíz «DB main» del árbol. El primer objeto aparece en y≈276.
- **Incumple:** Nielsen n.º 8. Convención de DataGrip, DBeaver y SSMS: un único árbol en el que la conexión es el nodo raíz y la base activa se marca en él (en negrita) o en la barra del editor.
- **Impacto:** menos espacio para el árbol, dos controles de desconexión distintos y confusión sobre qué es cada cosa.
- **Recomendación:** fundir conexiones y árbol en una sola lista en la que cada conexión abierta sea un nodo raíz con color, estado y acciones al pasar el ratón. Quitar el desplegable de base activa (marcarla en el árbol y en el selector de contexto del editor). Llevar las conexiones guardadas a la búsqueda «+» que ya existe.

### A-16 · Las tablas del árbol no se despliegan en columnas, claves, índices ni triggers
- **Área:** Árbol de objetos
- **Severidad:** Media
- **Problema:** en `object-tree-expanded.png` los nodos TBL no tienen flecha de despliegue. Para ver columnas o índices hay que abrir otra pestaña («Ver estructura», «Índices y constraints»).
- **Incumple:** la convención de DataGrip, DBeaver, SSMS y Navicat (tabla ▸ columnas / claves / índices / triggers, con el tipo junto al nombre).
- **Impacto:** se cambia constantemente de pestaña para consultas rápidas («¿cómo se llama la columna?»), y no se pueden arrastrar columnas al editor.
- **Recomendación:** carga diferida por tabla con las carpetas Columnas (nombre + tipo en gris, icono de clave para la PK y de enlace para las FK), Índices, Claves foráneas y Triggers. Permitir arrastrar un nodo al editor para insertar su nombre con comillas.

### A-17 · Faltan acciones habituales en el menú contextual del árbol
- **Área:** Árbol / menús
- **Severidad:** Media
- **Problema:** `tree-context-menu.png` solo ofrece Abrir datos, Ver estructura, Modificar tabla, Índices y constraints, Importar datos…, Copiar nombre, Refrescar y Eliminar…. Faltan «Nueva consulta (SELECT …)», «Generar SQL ▸ (SELECT / INSERT / DDL)», «Copiar DDL», «Exportar datos…», «Vaciar (TRUNCATE)…» y «Diagrama ER de esta tabla», y ninguna entrada muestra su atajo (Intro, F4, Supr).
- **Incumple:** la convención de DataGrip y DBeaver (Generate SQL, Copy DDL, Export Data, Truncate). Nielsen n.º 7.
- **Impacto:** tareas frecuentes que exigen escribir SQL a mano o pasar por varias pantallas.
- **Recomendación:** añadir un submenú «Generar SQL ▸» y las entradas «Nueva consulta sobre esta tabla», «Exportar…» y «Vaciar…» (con confirmación y en la zona de peligro). Mostrar atajos: Intro (abrir), F4 (modificar), Supr (eliminar).

### A-18 · Las herramientas que el motor no soporta siguen activas y el aviso se pinta como un error
- **Área:** Herramientas / capacidades
- **Severidad:** Media
- **Problema:** con SQLite, `tools-menu.png`, `command-palette.png` y la tira de herramientas ofrecen Monitor de servidor, Consultas lentas y Usuarios y permisos. Al abrirlas aparece una pantalla casi vacía con texto **rojo** («SQLite es una base de datos embebida…», `server-monitor.png`). Pasa lo mismo con «Constraints» en `index-manager.png`.
- **Incumple:** Nielsen n.º 1 y n.º 5. Fluent: deshabilitar lo que no aplica y explicar el motivo en el tooltip. El rojo se reserva para errores (consistencia semántica).
- **Impacto:** clics en vano y la sensación de que algo ha fallado cuando solo es una limitación del motor.
- **Recomendación:** deshabilitar (u ocultar en la paleta) las herramientas que el motor no soporta, con un tooltip que dé el motivo. Si se llega a la pantalla, mostrar un estado vacío informativo (icono, título neutro y texto gris), no un error.

### A-19 · La tira de 12 iconos sin texto es ambigua y está siempre visible, incluso deshabilitada
- **Área:** Barra de herramientas global
- **Severidad:** Media
- **Problema:** `welcome.png` muestra 12 iconos a 40 % de opacidad (contraste 1,76:1) sin conexión. Con conexión (`data-grid.png`) varios iconos son ambiguos: `{}` (procedimientos), ⚡ (triggers), la lupa (búsqueda en datos, que se confunde con el lanzador Ctrl+K) y el cuaderno (notebook). El rótulo solo está en el tooltip y no hay estado de botón pulsado.
- **Incumple:** Fluent y GNOME (iconos sin texto solo para acciones universales; si no, icono + etiqueta o agrupación). Nielsen n.º 6.
- **Impacto:** el usuario tiene que pasar el ratón por cada icono para saber qué hace.
- **Recomendación:** agrupar en 3 o 4 menús con texto («Servidor ▾», «Esquema ▾», «Datos ▾», «Herramientas ▾»), u ofrecer la opción «icono + texto». Ocultar la tira mientras no haya conexión.

### A-20 · La paginación no muestra el total, no deja elegir el tamaño de página y no salta a la última
- **Área:** Rejilla / paginación
- **Severidad:** Media
- **Problema:** la barra de estado solo muestra «‹ Filas 1–12 ›» (`data-grid.png`), con flechas de 10 px. No se ve el total de la tabla ni el tamaño de página (1000, implícito), y no hay primera/última página ni «Cargar todo».
- **Incumple:** la convención de DataGrip («1-500 of 10K+» y un selector de tamaño de página), DBeaver (Fetch next / Fetch all / Count) y TablePlus. Nielsen n.º 1.
- **Impacto:** no se sabe cuántos datos hay ni cuánto falta, y moverse por tablas grandes es tedioso.
- **Recomendación:** un control «|‹ ‹ 1–1000 de 48 213 › ›|» con el total bajo demanda («Contar» → COUNT(*) cancelable), un selector de tamaño (100/500/1000/Todo) y botones de al menos 24 px.

### A-21 · El orden de botones es el mismo en todas las plataformas y «Cerrar» aparece como acción principal
- **Área:** Diálogos y paneles
- **Severidad:** Media
- **Problema:** `ConfirmDialog.tsx` usa siempre [Cancelar] [Acción]. El formulario de conexión usa [Cancelar] [Guardar] [Guardar y conectar]. En Historial (`history-panel.png`), Filas de clientes (`fk-browser.png`), Detalle de fila (`row-detail.png`) y Atajos, el único botón relleno es **Cerrar**, cuando esas vistas ya son pestañas con su ×. En Estructura (`structure-view.png`) hay un «Cerrar» suelto abajo a la derecha.
- **Incumple:** las pautas de Windows (acción afirmativa a la izquierda de Cancelar: «Aceptar / Cancelar») frente a macOS y GNOME (Cancelar a la izquierda y la acción a la derecha). Fluent: el botón primario es la acción que hace avanzar la tarea, no la que cierra.
- **Impacto:** en Windows se pulsa por memoria muscular el botón equivocado, y el relleno de color pierde su significado.
- **Recomendación:** un helper `dialogButtons(platform)` que ordene según el SO. Quitar «Cerrar» de las vistas que viven en pestañas, o dejarlo como botón secundario, y reservar el relleno para la acción que avanza.

### A-22 · Los placeholders hacen de valor por defecto
- **Área:** Formularios / conexión
- **Severidad:** Media
- **Problema:** en `connection-form.png`, Host muestra «localhost» y Puerto «5432» en gris de placeholder, mientras el índice marca Servidor como incompleto. Pasa lo mismo con Keep-alive «0» (`connection-form-advanced.png`), «Default —» en `table-designer.png` y «/ruta/a/base.db» en SQLite. En tema oscuro (`connection-form-dark.png`) el placeholder casi no se distingue del texto real.
- **Incumple:** las guías de NN/g y GOV.UK (los placeholders no sustituyen a etiquetas ni a valores por defecto). WCAG 3.3.2 (etiquetas o instrucciones). Nielsen n.º 1.
- **Impacto:** no queda claro si el campo tiene valor, y se guardan conexiones a medias pensando que lo están.
- **Recomendación:** rellenar los valores por defecto reales (texto normal y editable) o mostrar un texto de ayuda «Por defecto: 5432» bajo el campo. En el diseñador de tablas, dejar Default vacío con la indicación «(sin valor por defecto)».

### A-23 · Los bordes de los campos no llegan al contraste mínimo
- **Área:** Accesibilidad / tokens
- **Severidad:** Media
- **Problema:** `--border` #d3d3dc sobre #ffffff da **1,49:1**, sobre `--bg-elev` 1,35:1, y en oscuro (#3a3a46 sobre #1e1e24) 1,48:1. Es el único elemento que delimita los campos de texto, los inputs «Filtrar» de la rejilla y los selectores (`data-grid.png`, `connection-form.png`). El caret del desplegable (#888) da 3,54:1 y las flechas del paginador son muy pequeñas.
- **Incumple:** WCAG 2.2 1.4.11 (contraste no textual ≥ 3:1 para los límites de componentes de interfaz).
- **Impacto:** a usuarios con baja visión, o con pantallas de poco contraste, les cuesta ver dónde se puede escribir.
- **Recomendación:** un token `--border-input` con ≥ 3:1 (p. ej. #8a8a96 en claro y #6a6a78 en oscuro) para campos y controles, dejando el `--border` actual para divisores decorativos.

### A-24 · Objetivos de clic por debajo de 24×24 px
- **Área:** Accesibilidad / interacción
- **Severidad:** Media
- **Problema:** el ✎ y el 🗑 del gestor de conexiones miden unos 10–12 px (`connection-manager.png`). El borrado de índice es un glifo de unos 6 px casi invisible (`index-manager.png`, x≈1190). Hay más casos: la «×» de quitar condición (`data-filter-condition-sort.png`), la × de las pestañas (opacidad 0,45), las flechas ‹ › del paginador, y el ▾ de «Consultas recientes», que es un objetivo separado de unos 12 px.
- **Incumple:** WCAG 2.2 2.5.8 (tamaño mínimo de objetivo, 24×24 o espaciado equivalente). Fluent (mínimo de 32 px en controles de comando de puntero y 40 px en táctil).
- **Impacto:** clics fallidos, y en el caso del 🗑, clics peligrosos.
- **Recomendación:** área mínima de 24×24 en todos los iconos de acción, con el glifo de 16 px centrado. Sustituir el glifo de borrado de índice por el icono de papelera estándar con su `aria-label`.

### A-25 · La confirmación de DROP no nombra el tipo de objeto, no avisa de dependencias y su botón destructivo es débil
- **Área:** Acciones destructivas
- **Severidad:** Media
- **Problema:** en `confirm-drop.png` el título es «Eliminar «clientes»» (no dice que es una tabla) y el texto, «Se eliminará clientes del servidor». No menciona que `pedidos.cliente_id` la referencia ni cuántas filas tiene. «Eliminar» es texto rojo sobre botón gris, con el mismo peso visual que Cancelar. (Es un acierto que muestre el SQL y que el foco empiece en Cancelar.)
- **Incumple:** Fluent y macOS HIG (diálogo destructivo con el objeto y las consecuencias concretas, y el botón destructivo con estilo propio). La convención de DataGrip y DBeaver de avisar de dependencias y ofrecer CASCADE.
- **Impacto:** se borran tablas referenciadas sin entender el alcance.
- **Recomendación:** título «¿Eliminar la tabla *clientes*?». Cuerpo: «12 filas · referenciada por *pedidos.cliente_id*». Botón relleno en rojo «Eliminar tabla». En conexiones protegidas, pedir que se escriba el nombre.

### A-26 · Vocabulario inconsistente e interfaz mezclada en dos idiomas
- **Área:** Contenido / i18n
- **Severidad:** Media
- **Problema:** «Densidad del grid» frente a «Rejilla» (`settings-grid.png`); «Constraints» (`index-manager.png`) frente a «Restricciones únicas» en Sincronizar estructura. La estructura muestra columnas crudas del motor, `name/type/notnull/dflt_value/pk` con 0/1 (`structure-view.png`). El SQL generado lleva comentarios en inglés («-- NOTE: checks not compared…», `schema-sync-result.png`). Los inputs de archivo nativos muestran «Choose File / No file chosen» (`backup-restore.png`, `import-wizard.png`). Los plurales se escriben «fila(s)» y aparece «1 filas» en `related-data.png`. Los textos de ayuda están en MAYÚSCULAS (`backup-restore.png`).
- **Incumple:** Nielsen n.º 2 y n.º 4. Las pautas de localización de Windows y GNOME (todo en el idioma de la UI y plurales correctos).
- **Impacto:** aspecto poco profesional, más carga de lectura y dudas sobre si dos términos significan lo mismo.
- **Recomendación:** un glosario único (rejilla, restricción, clave primaria, por defecto…). Plurales con `Intl.PluralRules`. Un botón propio «Elegir archivo…» que abra el diálogo nativo y muestre el nombre del archivo. Encabezados humanizados en Estructura (Columna, Tipo, Nulo, Por defecto, PK, con ✓ en lugar de 0/1). Comentarios del SQL generado en el idioma de la UI. Las ayudas, en caja normal.

### A-27 · Los colores semánticos se usan mal: éxito e información en rojo
- **Área:** Lenguaje visual
- **Severidad:** Media
- **Problema:** «1 fila(s) afectada(s).» sale en rojo (`tx-manual-pending.png`). También los avisos de función no soportada (`server-monitor.png`, `routines.png`, `index-manager.png`) y la validación prematura «El índice necesita un nombre.» antes de que el usuario escriba nada (`index-manager.png`).
- **Incumple:** WCAG 1.4.1 (no depender solo del color) y la consistencia semántica de Fluent y GNOME (rojo = error o peligro). Nielsen n.º 4.
- **Impacto:** el rojo deja de alarmar (fatiga de alertas) y un éxito se interpreta como fallo.
- **Recomendación:** tokens `--success`, `--info` y `--warning` diferenciados, con icono además del color. Mostrar la validación solo después de interactuar con el campo o al intentar enviar.

### A-28 · La vista de estructura es pobre en comparación con los clientes de referencia
- **Área:** Esquema / estructura
- **Severidad:** Media
- **Problema:** `structure-view.png` muestra una sola tabla con la salida cruda del PRAGMA. No hay FK (aunque `cliente_id` lo es), índices, triggers, comentarios ni recuento de filas, y hay un botón «Cerrar» suelto.
- **Incumple:** la convención de DataGrip, Navicat y TablePlus (pestaña de estructura con secciones Columnas, Índices, Claves foráneas, Triggers y DDL).
- **Impacto:** para entender una tabla hay que juntar tres pantallas.
- **Recomendación:** secciones plegables Columnas, Índices, Claves foráneas (con enlace a la tabla referenciada), Referenciada por y Triggers. Mantener DDL como segunda pestaña.

### A-29 · El generador de datos propone una secuencia desde 1 en la PK, que choca con las filas existentes
- **Área:** Herramientas / generador
- **Severidad:** Media
- **Problema:** en `data-generator.png`, la columna `id INTEGER` (PK, filas 1–12 ya existentes) aparece con «Secuencia · inicio 1 · paso 1». Con «Abortar todo» falla el lote entero y con «Omitir» las primeras 12 filas se pierden en silencio.
- **Incumple:** Nielsen n.º 5 (valores por defecto que evitan errores).
- **Impacto:** el primer intento falla siempre en una tabla con datos.
- **Recomendación:** para PK autoincrementales, usar «Omitir columna (la genera la BD)» por defecto. Si no lo son, empezar la secuencia en `MAX(id)+1` y avisar de conflictos en la vista previa.

### A-30 · Sincronizar estructura no resalta las operaciones que pierden datos
- **Área:** Herramientas / migración
- **Severidad:** Media
- **Problema:** en `schema-sync-result.png`, «− clientes.telefono — TEXT» genera `ALTER TABLE "clientes" DROP COLUMN "telefono"` (pérdida de datos) con el mismo peso visual que el resto. Los símbolos −/~ no tienen leyenda y el texto no deja claro en qué sentido va la sincronización (− significa «solo en destino»).
- **Incumple:** la convención de DataGrip y Redgate (marcar en rojo las sentencias destructivas y pedir confirmación aparte). Nielsen n.º 1 y n.º 5.
- **Impacto:** se aplica una migración que borra columnas con datos sin darse cuenta.
- **Recomendación:** mostrar las diferencias en una lista con icono y etiqueta («Solo en destino — se eliminará»). Agrupar las sentencias destructivas bajo «⚠ Elimina datos» y desactivarlas por defecto (casilla). Leyenda y flecha explícita «Origen → Destino».

---

## Bajas

### A-31 · El diagrama ER no muestra cardinalidad y sus líneas atraviesan las cajas
- **Área:** Herramientas / ER
- **Severidad:** Baja
- **Problema:** en `er-diagram.png` las aristas son discontinuas, sin flecha ni notación de cardinalidad. No salen de la columna FK concreta y una de ellas pasa por debajo de `detalle_pedido`. Las vistas no se distinguen visualmente de las tablas, y la FK no lleva icono (la PK lleva ★).
- **Incumple:** la convención de los diagramas ER (crow's foot o IE) de DataGrip, DBeaver y MySQL Workbench.
- **Recomendación:** anclar cada arista a la columna FK y a la PK de destino, usar la notación 1–N, aplicar un trazado ortogonal que evite las cajas, poner icono a las FK y dibujar las vistas con borde discontinuo.

### A-32 · Las pantallas de asistente no siguen una retícula común
- **Área:** Asistentes / formularios
- **Severidad:** Baja
- **Problema:** `data-search-results.png` mete cinco controles en una línea con etiquetas pegadas («…(valor exacto) Filas por tabla:»). `schema-sync.png` y `transfer-wizard-result.png` mezclan etiquetas en línea con desplegables de ancho completo. En `backup-restore.png` hay tres botones primarios en la misma pantalla.
- **Incumple:** GNOME HIG y Fluent (alineación de etiquetas consistente y una sola acción principal por vista). Nielsen n.º 4 y n.º 8.
- **Recomendación:** una plantilla de formulario de 2 columnas (etiqueta a la derecha / campo) para todos los asistentes. Una acción primaria por paso; si hay varias secciones, convertirlas en pestañas.

### A-33 · El toast de ejecución tapa la rejilla y repite lo que dice la barra de estado
- **Área:** Feedback
- **Severidad:** Baja
- **Problema:** en `editor-multiple-results.png` y `editor-result.png`, «Ejecutada a las 14:18:11 · 14 ms» tapa las filas 9–10 durante 4 s, aunque la barra de estado ya muestra la duración.
- **Incumple:** Nielsen n.º 8. Fluent (notificaciones solo para eventos que necesitan atención o que ocurren fuera de la vista).
- **Recomendación:** reservar los toasts para errores, operaciones largas o en segundo plano. El éxito de una consulta, solo en la barra de estado, o en un toast que no tape el área de datos.

### A-34 · La comparación de resultados no tiene estado vacío cuando todo coincide
- **Área:** Resultados / comparar
- **Severidad:** Baja
- **Problema:** en `result-compare.png` la rejilla aparece vacía bajo las cabeceras. Solo «12 iguales (ocultas)», en letra pequeña, explica por qué. Además, «nomb…» sale truncado.
- **Incumple:** Nielsen n.º 1 (los estados vacíos deben explicar qué pasa y qué hacer).
- **Recomendación:** un estado vacío centrado («✓ Los dos resultados son idénticos (12 filas)») con un botón «Mostrar filas iguales».

### A-35 · El diálogo de variables desactiva Ejecutar sin decir por qué
- **Área:** Editor / variables
- **Severidad:** Baja
- **Problema:** en `variables-dialog.png`, «Ejecutar» aparece deshabilitado (lila pálido) sin mensaje. El anillo de foco del primer campo se recorta y los tokens `${tabla}` / `:ciudad` no están asociados como `<label>`.
- **Incumple:** Nielsen n.º 9 y WCAG 3.3.2 / 1.3.1.
- **Recomendación:** mantener el botón activo y marcar el campo que falta al pulsarlo («Falta un valor para ${tabla}»). Usar `<label for>` y añadir margen para el anillo de foco.

### A-36 · «Sesión anterior»: Esc descarta el trabajo
- **Área:** Arranque / sesión
- **Severidad:** Baja
- **Problema:** en `restore-session-prompt.png`, Esc equivale a «Empezar en blanco» (`RestorePrompt.tsx`) y descarta tres pestañas con SQL sin ejecutar. El diálogo no dice si ese SQL queda en el Historial local.
- **Incumple:** macOS HIG y Fluent (Esc = la opción que no pierde nada).
- **Recomendación:** que Esc haga «Retomar» o simplemente posponga, o que el texto diga «Se guardarán en Historial local».

### A-37 · Al menú de pestañas le faltan acciones comunes y las pestañas de herramienta van en cursiva
- **Área:** Pestañas
- **Severidad:** Baja
- **Problema:** `tab-context-menu.png` solo ofrece Cerrar, Cerrar las demás, Historial local… y Nueva consulta, sin atajos visibles. Las pestañas de herramienta (Historial, Ajustes, Nueva conexión) van en cursiva, que en VS Code y JetBrains significa «pestaña de vista previa».
- **Incumple:** la convención de los IDE (Cerrar todas, Cerrar a la derecha, Fijar, Renombrar, Duplicar, Copiar ruta).
- **Recomendación:** completar el menú y mostrar Ctrl+W. Distinguir las herramientas con un icono, no con la cursiva.

### A-38 · El título de la ventana siempre es «Squaero»
- **Área:** Ventana
- **Severidad:** Baja
- **Problema:** según `tokens.md` §5, `webview_set_title("Squaero")` no cambia nunca.
- **Incumple:** la convención de Windows, macOS y GNOME («Documento — Aplicación» en la barra de título, la barra de tareas, Alt+Tab y Mission Control).
- **Recomendación:** «Consulta 1 — Ventas (SQLite) — Squaero», con un indicador «•» cuando haya cambios sin guardar.

### A-39 · Formato numérico inconsistente en columnas decimales
- **Área:** Rejilla / formato
- **Severidad:** Baja
- **Problema:** en `data-grid.png`, la columna `saldo NUMERIC(10,2)` muestra «980.5», «1590.4», «12» y «4321.99», con un número de decimales variable que impide alinear la coma decimal.
- **Incumple:** la convención de DataGrip y DBeaver (escala de la columna respetada y alineación decimal).
- **Recomendación:** formatear según la escala declarada y ofrecer un ajuste de separador según la configuración regional, sin tocar el valor que se copia.

### A-40 · En el buscador de FK hay un botón «Elegir» repetido en cada fila
- **Área:** Edición / FK
- **Severidad:** Baja
- **Problema:** `fk-browser.png` muestra doce botones «Elegir» idénticos. La rejilla usa otra tipografía y otro estilo que la rejilla principal, y el botón primario es «Cerrar».
- **Incumple:** la convención de selectores de búsqueda (seleccionar la fila + Intro o doble clic, y botón «Seleccionar» abajo). Nielsen n.º 4.
- **Recomendación:** reutilizar `ResultGrid` con selección de fila, Intro o doble clic para elegir, y los botones [Seleccionar] (primario) y [Cancelar].

### A-41 · El detalle de fila parece editable cuando no lo es
- **Área:** Rejilla / detalle
- **Severidad:** Baja
- **Problema:** en `row-detail.png` los valores en solo lectura se ven en cajas con borde, como inputs. El título «Detalle de fila» se parte en dos líneas y el botón primario es «Cerrar».
- **Incumple:** Nielsen n.º 4 (affordance coherente).
- **Recomendación:** en solo lectura, mostrar los valores como texto seleccionable sin borde y la caja solo en modo edición. Título en una línea con la navegación al lado. «Editar» como acción principal.

### A-42 · Los temas que solo tienen variante oscura se pueden elegir en modo Claro sin que cambie nada
- **Área:** Ajustes / apariencia
- **Severidad:** Baja
- **Problema:** en `settings-appearance.png` se pueden elegir Ciruela, Pizarra y Terminal con el modo Claro activo. Según `tokens.md` §2 son «dark only», así que en claro se ve Indigo y el clic no produce ningún cambio visible.
- **Incumple:** Nielsen n.º 1.
- **Recomendación:** etiquetar esos temas como «(solo oscuro)», deshabilitarlos en modo Claro con un tooltip, o cambiar a Oscuro automáticamente al elegirlos y avisar de ello.

---

## Lo que ya funciona bien (mantener)

1. **Protección por conexión (Solo lectura / Confirmar escrituras).** Hay distintivo 🔒 en la conexión y en la pestaña, franja de color rayada y un bloqueo explícito antes de enviar la sentencia («…lo que se iba a ejecutar escribe y no se ha enviado», `safe-mode-readonly.png`). Supera lo que ofrecen DBeaver o TablePlus.
2. **SQL visible antes de aplicar.** DROP (`confirm-drop.png`), la confirmación de edición, Sincronizar estructura, el diseñador de tablas y el constructor de consultas muestran el SQL exacto. El ConfirmDialog arranca con el foco en Cancelar, atrapa el foco y Esc cancela.
3. **Honestidad de capacidades.** Las opciones deshabilitadas explican por qué («Eliminar fila: primero entra en modo edición», «Datos relacionados: solo desde id», «Solo lectura: el resultado no corresponde a una sola tabla…»). Es un buen patrón: falta aplicarlo con el color correcto (A-18).
4. **Navegación por teclado.** Paleta Ctrl+K con Ctrl+P (objetos) y Ctrl+J (snippets con vista previa), atajos configurables con detección de conflictos (`settings-shortcuts.png`), menú contextual con Shift+F10 o tecla Menú, `:focus-visible` con un anillo de 2 px y `prefers-reduced-motion`.
5. **NULL bien diferenciado en lectura.** La etiqueta `NULL` (`data-grid.png`), los colores por tipo configurables con aviso de «Contraste bajo sobre el fondo» (`settings-grid.png`) y los tipos bajo cada cabecera.
6. **Formulario de conexión.** Índice de secciones con estado, tarjetas de motor con el puerto por defecto, vista previa, «Probar conexión» con la latencia y «Guardar y conectar» como acción principal clara (`connection-form.png`).
7. **Red de seguridad para el SQL.** Historial local con diff por versión y restauración (`local-history.png`), historial de consultas filtrable y una consulta larga que se puede cancelar («Ejecutando… [Cancelar]»).
8. **Exploración relacional.** Datos relacionados (`related-data.png`) con recuento por tabla y la SQL generada, el detalle de fila con navegación y la tira de acciones flotante para las filas marcadas (`grid-row-action-bar.png`), con los atajos visibles.
