# Auditoría UI/UX — rediseño M14 de Squaero

Alcance: la propuesta en `scratchpad\redesign\` (REDESIGN.md, `theme-helmet.txt`, los 8 componentes compartidos y unas 75 de las 94 pantallas `bodies\*.body`), comparada con la app actual (`screens\inventory.md` y capturas). Los contrastes se calculan con la fórmula WCAG 2.x a partir de los tokens del helmet. Los colores con alfa se mezclan sobre el fondo real en el que se usan. Los scripts están en `scratchpad\audit\contrast.py` y `c2.py`.

Referencias: Windows (Fluent/Win32), macOS HIG, GNOME HIG, WCAG 2.2 AA, las heurísticas de Nielsen (H1–H10) y lo que hacen DataGrip, DBeaver, TablePlus, Navicat, SSMS y Postico.

**Resumen: 43 hallazgos. 4 críticos, 13 altos, 20 medios y 6 bajos.**

---

## Hallazgos

### Críticos

**R-01 · Ejecución y tareas largas · Crítica**
- **Problema:** ninguna pantalla muestra una operación en curso ni deja cancelarla. No existe el estado «Ejecutando…» con botón Detener en el editor (`EditorEmpty`, `EditorResult`, `TxManualPending`). Faltan también el progreso y la cancelación de Buscar en los datos (`DataSearch`, `DataSearchResults`), Respaldo (`BackupRestore`), Importar, Transferir y Sincronizar. `ExportMenu` remite el progreso a una notificación. La cadena «Cargando» no aparece en ninguna pantalla: no hay estados de carga del árbol, de la rejilla ni de los paneles. Es una regresión: la app actual tiene «Ejecutando… [Cancelar]» y «Buscando en la tabla i/n…» con Cancelar.
- **Incumple:** Nielsen H1 (visibilidad del estado) y H3 (control y libertad). Los clientes de BD siempre muestran la consulta en curso con su cronómetro y un botón para pararla (SSMS, DataGrip, DBeaver).
- **Impacto:** un SELECT sin LIMIT o un bloqueo deja la app «muerta» sin salida. El usuario cierra la app o mata el proceso y pierde trabajo.
- **Recomendación:**
  1. Mientras corre una consulta, el botón Ejecutar pasa a ser **Detener** en la misma posición, con estilo danger e icono ■. Atajos: `Ctrl+Pausa` y `Esc` cuando el foco está en los resultados.
  2. La cabecera de resultados muestra «Ejecutando · 00:04 · sentencia 2 de 3» y un enlace [Cancelar].
  3. Si la tarea pasa de 300 ms, se muestra un esqueleto en la rejilla. A partir de 1 s, progreso determinado cuando se conoce (filas exportadas, tablas buscadas) y un spinner en la pestaña del documento.
  4. Diseñar estas pantallas: EditorRunning, DataSearchRunning, ExportProgress y TreeLoading.

**R-02 · Contexto de conexión · Crítica**
- **Problema:** nada indica contra qué conexión y base corre cada pestaña.
  - `DocTabs` acepta la prop `conn`, pero no la pinta.
  - El Explorador muestra una sola conexión y la cambia con un selector (`Explorer.body`, «Cambiar de conexión»).
  - La barra del editor no tiene selector de conexión ni de base de datos.
  - En `SafeModeReadonly` la pestaña, el aviso y la barra de estado dicen «Producción», pero el Explorador sigue mostrando «Ventas · SQLite». El atributo `conn-name` no coincide con la prop `connName`, y eso prueba lo frágil del modelo.
  - Es una regresión: hoy la pestaña lleva un borde con el color de la conexión, el título « · {conn}» y una franja de color en el workspace.
- **Incumple:** Nielsen H1 y H5 (prevención de errores). Convención de SSMS (combo de base en la barra de consulta) y de DataGrip (selector de sesión y esquema en el editor, color por conexión).
- **Impacto:** ejecutar un DELETE en Producción creyendo estar en Ventas. Es el error más caro que puede cometer un cliente de BD.
- **Recomendación:**
  1. Poner al principio de la barra de ejecución un desplegable obligatorio «● Ventas · main ▾», con el color de la conexión y la lista de conexiones abiertas y sus bases.
  2. En cada pestaña de consulta, una franja de 2–3 px con el color de la conexión y un título «Consulta 1 · Producción» cuando haya más de una conexión abierta.
  3. El Explorador refleja la conexión de la pestaña activa, o muestra varias conexiones a la vez (ver R-35).

**R-03 · Accesibilidad: foco · Crítica**
- **Problema:** el helmet solo define el foco de `.field` (`:focus` y `.is-focus`). `.btn`, `.mi`, `.seg>*`, pestañas, Rail, filas del árbol (`<a role="treeitem">`), celdas de la rejilla, chips y enlaces no tienen ningún estilo de foco. Ninguna pantalla dibuja el estado «con foco» de un botón o una fila. El foco de los campos es un borde de 1 px más un halo `--accent-soft` de 1,14–1,28:1, que no se distingue.
- **Incumple:** WCAG 2.4.7 «Foco visible» (AA) y 2.4.11 «Foco no oculto» (AA). La 2.4.13 (AAA) sirve de guía. Windows y GNOME exigen un anillo de foco visible al navegar con teclado.
- **Impacto:** quien trabaja solo con teclado (muchos usuarios avanzados de BD) no sabe dónde está. Bloquea por completo a usuarios de teclado y lectores de pantalla.
- **Recomendación:**
  - Regla global `.th :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
  - Dentro de la rejilla y del árbol, un `box-shadow: inset 0 0 0 2px var(--accent)` (el accent da 3,97–8,7:1 en los cuatro estilos y cumple 3:1).
  - En los campos, sustituir el halo del 10 % por un borde de 2 px.
  - Añadir un artboard «navegación con teclado» con el foco visible en la barra de herramientas, el árbol y la rejilla.

**R-04 · Editor: alcance de ejecución · Crítica**
- **Problema:** las indicaciones sobre qué ejecuta `Ctrl+Enter` se contradicen.
  - `Welcome`: «Ctrl Enter ejecuta la sentencia bajo el cursor o la selección».
  - La barra de todas las pantallas del editor muestra por defecto **«Todo»** (`aria-label` «todo el documento o la selección»).
  - El pie de resultados dice «Ejecutada … · todo el documento».
  - Además se ejecuta en «Auto» por defecto, sin resaltar la sentencia que se va a enviar.
- **Incumple:** Nielsen H4 (consistencia) y H5. En DataGrip y DBeaver, `Ctrl+Enter` ejecuta la sentencia actual y ejecutar el script es otro comando (`Alt+X`, «Ejecutar script»). En SSMS, F5 ejecuta la selección o todo, pero el editor resalta lo que se ejecuta.
- **Impacto:** un usuario que espera ejecutar solo el SELECT de la línea 4 ejecuta también el `DELETE` de la línea 9, que se confirma al momento.
- **Recomendación:**
  - Tres alcances explícitos:
    - «Sentencia actual»: `Ctrl+Enter`, por defecto.
    - «Selección»: automático si hay texto seleccionado.
    - «Todo el script»: `Ctrl+Shift+Enter` o `Alt+X`.
  - Resaltar en el editor (fondo `--accent-soft` y barra en el margen) el bloque que se va a enviar.
  - El botón dice qué hará: «▶ Ejecutar sentencia», «▶ Ejecutar selección (3 líneas)» o «▶ Ejecutar script».
  - Si un script de varias sentencias contiene escrituras y el modo es Auto, mostrar un aviso inline.

### Altos

**R-05 · Ciclo de vida de la conexión · Alta**
- **Problema:** «Desconectar» no aparece en ninguna de las 94 pantallas. Tampoco hay un estado «desconectada / reconectando» en el Explorador ni un botón Reconectar en el shell: solo aparece como acción en una notificación (`Notifications`). Es una regresión: la app actual tiene ⏏ «Desconectar {name}», ↻ «Reconectar», «reconectando…» y «desconectada» en la barra de conexiones.
- **Incumple:** Nielsen H3 y H1. DBeaver, DataGrip y TablePlus tienen desconectar y reconectar en el árbol y en la barra de herramientas.
- **Impacto:** no se puede soltar una sesión en Producción ni liberar bloqueos. Una caída de red no deja ningún rastro visible fuera del toast.
- **Recomendación:**
  - Añadir «Desconectar» (⏏) y «Reconectar» en la tarjeta de conexión del Explorador, en su menú contextual, en el menú Archivo y en la paleta.
  - Al perder la conexión, el punto de estado pasa a `--danger`, la tarjeta muestra «Desconectada · [Reconectar]» y los documentos de esa conexión enseñan una banda «Sin conexión: los cambios pendientes se conservan».

**R-06 · Seguridad en Producción · Alta**
- **Problema:** el color de conexión que el usuario elige en `ConnectionForm` (Apariencia › Color) no se usa en ninguna parte del shell: el distintivo del Explorador usa el color del motor. La protección «Solo lectura» se pinta con `--danger` (rojo de error) en `StatusBar`, `ConnectionManager` y `Welcome`, y «Confirmar escrituras» en ámbar. Hoy la app tiene una franja rayada en el workspace para las conexiones protegidas.
- **Incumple:** la convención de color por conexión de DataGrip («Color» por origen de datos), DBeaver («Connection type: Production», con tinte en el editor) y SSMS (color en la barra de estado). El rojo debe reservarse para errores (H4).
- **Impacto:** se pierde la señal preatentiva más eficaz contra errores en Producción, y un estado seguro (solo lectura) se lee como un error.
- **Recomendación:**
  1. El color de la conexión tiñe la franja de la pestaña, la tarjeta del Explorador y el punto de la barra de estado. Para las conexiones marcadas como Producción, opcionalmente también un borde de 2 px alrededor de `<main>`.
  2. «Solo lectura»: chip neutro con candado (`--accent-soft` o gris).
  3. «Confirmar escrituras»: ámbar con escudo.
  4. Añadir en el formulario el campo «Tipo de entorno» (Desarrollo / Pruebas / Producción) con un color por defecto.

**R-07 · Integración con el sistema operativo · Alta**
- **Problema:** `TitleBar.body` dibuja la misma barra en los tres sistemas: menú integrado, búsqueda de 440 px y los botones minimizar/maximizar/cerrar de Windows (46 px a la derecha). La «Barra de menús nativa» está desactivada por defecto (`SettingsWindow`).
  - En macOS la barra de menús debe ser la global del sistema y los semáforos van a la izquierda.
  - En GNOME el orden de los botones lo decide `gtk-decoration-layout` (a menudo solo «cerrar»).
  - En Windows 11 el botón maximizar debe mostrar Snap Layouts, lo que exige `HTMAXBUTTON` en `WM_NCHITTEST`.
- **Incumple:** macOS HIG (Menu bar, Window anatomy), GNOME HIG (header bars y decoraciones del cliente), y en Windows las pautas «Title bar customization» de Snap Layouts y el área de arrastre.
- **Impacto:** en macOS la app parece un port y faltan los menús en la barra del sistema. En Linux, botones duplicados o en el lado equivocado. En Windows se pierde Snap.
- **Recomendación:**
  - **macOS:** menú nativo siempre, semáforos a la izquierda con 78 px de margen, sin el menú «Ventana» duplicado.
  - **Windows:** caption buttons nativos y Snap.
  - **Linux:** respetar el layout de decoración, o usar una header bar con menú de hamburguesa como en GNOME.
  - En los tres: reservar al menos 120 px de zona de arrastre libre y bajar la búsqueda a 320 px.

**R-08 · Diálogos: orden de botones y botón por defecto · Alta**
- **Problema:** el brief fija el orden de Windows ([Primario] [Cancelar]) para los tres sistemas, y además se incumple en varias pantallas:
  - `DataFilterCondition` y `DataFilterSql`: [Limpiar] [Aplicar], con el primario al final.
  - `RestoreSessionPrompt`: [Retomar] [Empezar en blanco], sin Cancelar.
  - `SnippetSaveInline`: «Guardar» es secundario.
  - `ConfirmDrop`: el foco está en el campo ya relleno, así que Intro ejecuta el borrado.
- **Incumple:** en macOS HIG el botón por defecto va el último a la derecha y Cancelar a su izquierda. En GNOME HIG, Cancelar a la izquierda y la acción afirmativa a la derecha. En Windows y macOS, en los diálogos destructivos el botón por defecto debe ser el seguro.
- **Impacto:** quien tiene memoria muscular de su plataforma pulsa el botón equivocado. En un diálogo de borrado eso cuesta datos.
- **Recomendación:**
  - Un solo componente `DialogFooter` que ordene por plataforma: Windows [Aceptar][Cancelar]; macOS y GNOME [Cancelar][Aceptar].
  - En los diálogos de peligro, el botón danger empieza deshabilitado hasta que el nombre escrito coincida. Intro no lo activa nunca por defecto y Esc siempre cancela.
  - Corregir las pantallas citadas.

**R-09 · Contraste del texto tenue · Alta**
- **Problema:** `--text-faint` da entre 2,54 y 3,41:1 en los cuatro estilos (ver la tabla de contraste). Se usa en texto informativo, no en texto deshabilitado:
  - los atajos de los menús (`.mi .k`, sobre `--overlay`: 2,92–3,11);
  - los contadores del árbol, los números de fila y el indicador de orden de la rejilla;
  - los subtítulos de las conexiones guardadas (`Explorer`);
  - el valor NULL (`--null`, que es igual a faint);
  - los comentarios SQL (`--syntax-comment`, que también es igual a faint).
- **Incumple:** WCAG 1.4.3 «Contraste mínimo» (AA, 4,5:1 para texto menor de 18,66 px en negrita).
- **Impacto:** los atajos, los NULL y los comentarios no se leen bien en pantallas de oficina con brillo alto o con baja visión.
- **Recomendación:**
  - Usar faint solo para elementos decorativos o deshabilitados, y `--text-dim` para todo el texto informativo.
  - Si se mantiene faint, oscurecerlo hasta cumplir sobre `--chrome-2`:
    - B: `#5b646e` (5,11 sobre chrome; 4,73 sobre chrome-2).
    - A: `#828c99` (4,86 sobre overlay).
    - C: `#958a74` (4,91 sobre overlay).
    - Rosa: `#7f5e6e` (4,77 sobre chrome).

**R-10 · Bordes de controles y anillo de foco · Alta**
- **Problema:** `--border-strong`, que es el borde de `.field`, `.btn` y `.seg`, da 1,50–1,57:1 sobre `--content` y 1,32–1,57:1 sobre `--chrome`. El filtro del Explorador, sobre chrome, se queda en 1,32:1 en el estilo B. El halo de foco `--accent-soft` da 1,14–1,28:1.
- **Incumple:** WCAG 1.4.11 «Contraste de elementos no textuales» (3:1 para los límites que identifican un control).
- **Impacto:** los campos y los botones secundarios parecen texto suelto. Es difícil localizar dónde escribir, sobre todo en los formularios de conexión y en los asistentes.
- **Recomendación:** separar `--border` (decorativo) de `--border-control` (3:1):
  - B: `#7a838e` (3,84 sobre content; 3,27 sobre chrome).
  - A: `#5f6a78` (3,42 / 3,01).
  - C: `#75684f` (3,37 / 3,07).
  - Rosa: `#a27890` (3,61 / 3,16).

  El foco se resuelve como en R-03.

**R-11 · Regresión: acciones escondidas en «Más» · Alta**
- **Problema:** en el documento de tabla (`DataGrid`, `SyncMenu`), «Más» esconde 10 acciones que hoy están a la vista en la barra: Generar datos, Transferir, Sincronizar estructura y datos, Transponer, Fijar resultado, Comparar con…, Graficar, Ver SQL, Estructura y Plan. «Historial» y «Snippets» desaparecen de la barra de tabla.
  - En el resultado de una consulta (`EditorResult`), en cambio, Transponer, Fijar, Comparar y Graficar sí están visibles. La misma rejilla muestra herramientas distintas según su origen.
  - El menú mezcla tres categorías: generar o mover datos, ver el resultado y navegar por el objeto.
- **Incumple:** Nielsen H4 (consistencia) y H6 (reconocer antes que recordar). Es una regresión de la capacidad de descubrimiento.
- **Impacto:** dos clics más para tareas frecuentes, y el usuario actual no encuentra Comparar ni Graficar.
- **Recomendación:**
  - Una única barra de resultado, la misma para tabla y consulta: Transponer · Fijar · Comparar · Graficar · Exportar, en un grupo a la derecha.
  - «Más» solo para lo raro: Generar, Transferir, Sincronizar.
  - Estructura, DDL y Plan pasan al conmutador de R-12.

**R-12 · Navegación dentro del objeto · Alta**
- **Problema:** `StructureView`, `DdlView` e `IndexManager` tienen el conmutador «Estructura · Índices · DDL · Datos», pero `DataGrid`, que es la vista de entrada, no lo tiene: a la estructura solo se llega por «Más › Estructura». La navegación no es simétrica.
- **Incumple:** Nielsen H4 y H7 (eficiencia). TablePlus (Data/Structure en la parte inferior), DataGrip y DBeaver (pestañas Properties/Data/ER Diagram dentro del editor de tabla) ponen el conmutador siempre en el mismo sitio.
- **Impacto:** el usuario no ve que puede cambiar de vista, y volver de la estructura a los datos y de nuevo a la estructura cuesta dos clics más.
- **Recomendación:** poner el mismo `seg` «Datos · Estructura · Índices · DDL» en todas las vistas del objeto, a la izquierda de la barra de documento, siempre en la misma posición. Atajos: `Ctrl+Alt+1…4`, o `Alt+1…4` si no chocan con el sistema (ver R-17).

**R-13 · Rejilla: tipos y claves foráneas · Alta**
- **Problema:**
  - El tipo de columna solo se ve como un punto de 6 px de color, con el nombre del tipo en el `title` (`Grid.body`). Hoy el tipo aparece bajo el nombre (INT, TEXT…).
  - Las celdas con clave foránea no tienen ninguna marca. Hoy la app las subraya y pone una flecha «Ver los datos relacionados». En `GridContextMenuFk` la relación solo se descubre con clic derecho o en el tooltip (`type: "integer → clientes.id"`).
- **Incumple:** WCAG 1.4.1 «Uso del color» y 1.4.13 (contenido solo al pasar el puntero). Nielsen H6. DataGrip y DBeaver muestran el tipo en la cabecera y navegan por clave foránea con un icono en la celda.
- **Impacto:** el usuario avanzado pierde información que consulta constantemente para escribir filtros y JOIN, y la navegación por claves foráneas deja de descubrirse.
- **Recomendación:**
  - Una segunda línea en la cabecera con el tipo (11 px, `--text-dim`), desactivable en Ajustes › Rejilla.
  - Icono 🔑 para la clave primaria y ↗ para la clave foránea en la cabecera.
  - En la celda con clave foránea, una flecha de 12 px al pasar el puntero o con el foco, que se abre con `Ctrl+clic` o `Ctrl+B`.

**R-14 · Modelo de edición de la rejilla · Alta**
- **Problema:**
  - Hay que pulsar «Editar» (primario) para entrar en un modo explícito. «Fila» también entra en ese modo.
  - En modo edición la barra (`GridEditMode`, `GridPendingChanges`) no tiene primario. «Guardar» solo aparece en el panel inferior cuando hay cambios.
  - «Terminar edición» convive con 3 cambios pendientes sin decir qué hará con ellos.
  - Para editar una celda se indica «Doble clic o Intro», sin `F2`.
- **Incumple:** Nielsen H3 y H5. En DataGrip, DBeaver y TablePlus la edición es en el sitio: los cambios pendientes se resaltan y se envían con «Submit» (`Ctrl+Enter` o `Ctrl+S`). En Excel, DataGrip y SSMS `F2` edita la celda.
- **Impacto:** un clic más en la tarea más frecuente, y riesgo de perder o enviar cambios al pulsar «Terminar edición».
- **Recomendación:**
  - Editar directamente en una tabla editable (doble clic, `F2` o empezar a escribir). El chip «Editando» aparece solo cuando hay cambios.
  - Mientras haya cambios, la barra muestra **[Guardar (3)] primario** y [Descartar], y el pie mantiene la vista previa del SQL.
  - «Terminar edición» con cambios abre un diálogo: Guardar / Descartar / Seguir editando.
  - Intro confirma la celda y baja a la siguiente fila. Esc revierte la celda.

**R-15 · Sincronizar estructura · Alta**
- **Problema:** en `SchemaSyncResult`, «Aplicar en destino» es el botón primario (accent, no danger), aunque el diff incluye «− Columna clientes.telefono · solo en el destino», es decir, una sentencia que borra datos. El paso «3 Aplicar» no tiene pantalla y no hay confirmación. Hoy la app pide «¿Aplicar la migración?».
- **Incumple:** Nielsen H5. Las acciones destructivas deben distinguirse visualmente y confirmarse (Windows y macOS HIG, «Destructive actions»). Navicat y DataGrip muestran el script y piden confirmación con el destino nombrado.
- **Impacto:** se pueden borrar columnas con datos en otra base, incluida Producción, con un solo clic en el botón más llamativo.
- **Recomendación:**
  - Si el script contiene DROP o ALTER … DROP, el botón pasa a btn-danger: «Aplicar 3 sentencias en Ventas copia».
  - Confirmación que nombre el destino y cuente las sentencias destructivas.
  - Si el destino es de solo lectura o Producción, bloquear o pedir que se escriba el nombre.
  - Añadir la pantalla «3 Aplicar» con el progreso y el resultado de cada sentencia.

**R-16 · Selección por rangos · Alta**
- **Problema:** la rejilla solo modela una celda seleccionada (`selected {r,c}`) y filas marcadas. No hay selección rectangular (`Shift+clic` o arrastrar). El resumen «n celdas · NULL · Suma · Media · Mín · Máx» de la barra de estado actual desaparece: solo queda una suma de las filas marcadas en `GridRowActionBar`.
- **Incumple:** Nielsen H7. Las convenciones de hoja de cálculo que siguen DataGrip y DBeaver (selección de rango, copiar como TSV, agregados en la barra de estado).
- **Impacto:** se pierde el flujo «seleccionar un bloque → ver la suma → copiar a Excel», muy frecuente en análisis.
- **Recomendación:**
  - Selección de rango con `Shift+flechas`, `Shift+clic` y arrastre; `Ctrl+clic` para añadir celdas.
  - `Ctrl+C` copia en TSV, y el menú ofrece «Copiar como CSV / Markdown / INSERT / JSON».
  - Barra de estado: «12 celdas · 1 NULL · Suma 5 642,49 · Media 470,21».

**R-17 · Atajos que chocan con el sistema · Alta**
- **Problema:** varios atajos de `ShortcutsHelp` y `TxControlsMenu` chocan con el sistema o con otros atajos de la app:
  - `Ctrl+Alt+L` (cambiar tema) bloquea la pantalla en muchos escritorios Linux (Cinnamon, XFCE, Ubuntu antiguo).
  - `Ctrl+Alt+↑/↓` (añadir cursor) rota la pantalla con los drivers gráficos de Intel en Windows y cambia de espacio de trabajo en GNOME.
  - `Ctrl+Alt+C` y `Ctrl+Alt+R` (Confirmar y Revertir la transacción) equivalen a `AltGr+C` y `AltGr+R` en Windows, que escriben ć o ® en distribuciones de teclado polacas y otras.
  - `Ctrl+D` y `Ctrl+Shift+L` significan cosas distintas en el editor y en la rejilla.
- **Incumple:** las pautas de teclado de Windows (no usar `Ctrl+Alt` como modificador de comandos por AltGr), GNOME HIG «Keyboard» (atajos reservados) y Nielsen H5.
- **Impacto:** atajos que no funcionan o que hacen otra cosa. Que «Revertir» dependa de `AltGr` es especialmente delicado.
- **Recomendación:**
  - Confirmar con `Ctrl+Shift+Enter` o `Alt+Shift+C`, y revertir con `Alt+Shift+R`.
  - Tema: sin atajo por defecto, o `Ctrl+K T`.
  - Cursores: `Alt+Shift+↑/↓`, como en VS Code en Windows y Linux.
  - Detectar conflictos con el sistema en `SettingsShortcuts`.

### Medios

**R-18 · Rail y modelo de navegación · Media**
- **Problema:** el Rail (`Rail.body`) mezcla dos modelos.
  - Parece una barra de actividad (Explorar, Historial, Snippets…), pero sus entradas abren pestañas de documento en lugar de cambiar el panel lateral, y el Explorador sigue visible.
  - «Más» abre `ToolsMenu`, que repite Diagrama, Snippets, Monitor, Buscar y Conexiones, ya presentes en el Rail.
  - «Monitor» está fijo en el Rail aunque en SQLite está deshabilitado (opacidad .4, sin explicación).
  - «Buscar» (en los datos) compite con la búsqueda `Ctrl K` de la barra de título.
  - Las etiquetas son de 10 px.
- **Incumple:** Nielsen H4 y H8 (diseño minimalista). El patrón de barra de actividad (VS Code, DataGrip: tool windows) cambia la vista lateral.
- **Impacto:** 64 px de ancho fijo para accesos redundantes, y un modelo mental confuso: ¿esto abre un panel o una pestaña?
- **Recomendación:**
  - Opción (a): el Rail cambia el contenido de la columna de 248 px (Explorador / Historial / Snippets / Buscar), como VS Code.
  - Opción (b): quitar el Rail y dejar las herramientas en el menú, en la paleta y en el menú contextual de la conexión.
  - Renombrar «Buscar» a «Buscar datos».
  - Ocultar del Rail las herramientas que el motor activo no soporta.
  - Etiquetas de al menos 11 px, o solo iconos con tooltip y colapsable a 48 px.

**R-19 · Barra del editor sobrecargada · Media**
- **Problema:** la barra de ejecución (`EditorResult` y similares) tiene unos 11 controles: Ejecutar, Todo (los dos primarios), Formatear, Plan, el segmento Auto/Manual/⚙, Historial, recientes, Guardar snippet y Más. Esto supera el límite de 7 que fija el propio brief.
  - «Plan» está como botón y también como pestaña del panel de resultados.
  - «Historial» está en la barra y en el Rail.
  - «Abrir .sql» y «Guardar .sql», operaciones básicas de archivo, quedan en «Más» y sin atajo (`Welcome` anuncia `Ctrl O`, pero `Ctrl S` es «guardar cambios de la rejilla»).
- **Incumple:** la regla de 7 acciones del brief, Nielsen H8 y la convención de archivos (`Ctrl+O` / `Ctrl+S` en un editor de texto).
- **Impacto:** ruido visual en la zona más usada y duplicados que confunden.
- **Recomendación:** dejar `[conexión ▾] [▶ Ejecutar ▾] [■] | Formatear | Auto/Manual | Más`.
  - Quitar el botón Plan (queda la pestaña y `Ctrl+Shift+E`).
  - Mover Historial y recientes a un solo «Historial ▾».
  - En una pestaña de consulta, `Ctrl+S` guarda el archivo .sql; en la rejilla, guarda los cambios.

**R-20 · Regla del botón primario · Media**
- **Problema:** la regla del brief (un solo primario por vista) se incumple en varias pantallas.
  - Dos primarios contiguos (Ejecutar y «Todo»): en todas las pantallas del editor.
  - `EditorEmpty`: Ejecutar deshabilitado y «Insertar un snippet» como primario.
  - `GridEditMode`: ningún primario.
  - `DataSearch`: la acción principal «Buscar en 4 de 4 tablas» es ghost.
  - `UsersGrants`: «Nuevo usuario» es secundario y «Otorgar» primario en la misma vista.
  - `SnippetSaveInline`: «Guardar» es secundario.
- **Incumple:** Nielsen H4 y el propio sistema de diseño.
- **Impacto:** la jerarquía visual deja de señalar el siguiente paso.
- **Recomendación:**
  - El selector de alcance es un botón partido: la parte principal es primaria y la flecha queda dentro del mismo control, con un divisor de 1 px.
  - En `DataSearch`, «Buscar» primario.
  - En edición, «Guardar (n)».
  - Validar con un lint del sistema: máximo un `.btn-primary` por `role="toolbar"` o `.dlg-f`.

**R-21 · Dos filtros con alcances distintos · Media**
- **Problema:** «Filtros por columna» (`GridColumnFilter`) filtra en local solo la página cargada («3 de 12 filas coinciden en esta página», «filtro local»), mientras que «Filtrar» (`DataFilterCondition`) filtra en el servidor. Los dos tienen un nombre casi igual y están en la misma barra.
- **Incumple:** Nielsen H2 (coincidencia con el mundo real) y H4.
- **Impacto:** con páginas de 1000 filas el usuario cree que «no hay coincidencias» cuando sí las hay en el resto de la tabla.
- **Recomendación:**
  - Renombrar el local a «Buscar en la página» (icono de lupa, `Ctrl+F` sobre la rejilla) y mostrar siempre «solo en las 1000 filas cargadas · [Filtrar en la tabla]».
  - O bien enviar los filtros por columna como WHERE al servidor, como hace DBeaver.

**R-22 · Popover de filtro · Media**
- **Problema:** en `DataFilterSql`, «Aplicar» lleva el atajo `Intro`, pero el foco está en un `<textarea>` WHERE de varias líneas, donde Intro inserta un salto de línea. «Filtrar» y «Ordenar» abren el mismo popover. Las etiquetas `lbl` «WHERE» y «ORDER BY» salen en minúsculas en el estilo C (ver R-39).
- **Incumple:** la convención de los campos de varias líneas (Intro escribe; `Ctrl+Enter` envía) y Nielsen H4.
- **Impacto:** o no se puede escribir un WHERE de varias líneas, o el filtro se aplica a medias.
- **Recomendación:**
  - Aplicar con `Ctrl+Enter` (mostrar el kbd).
  - «Ordenar» abre el popover con el foco en «Ordenar por».
  - Las etiquetas de palabras clave SQL no usan la clase `lbl`.

**R-23 · Densidad de información · Media**
- **Problema:** en el editor se apilan:

  | Elemento | Alto |
  | --- | --- |
  | Barra de título | 38 px |
  | Pestañas | 36 px |
  | Barra de ejecución | 44 px |
  | Editor | 220 px |
  | Separador | 6 px |
  | Pestañas de resultados | ≈32 px |
  | Barra de resultado | ≈40 px |
  | Barra de estado | 24 px |

  Con eso quedan unas 11 filas de rejilla a 1280×800. En horizontal, Rail y Explorador ocupan 312 px (hoy la barra lateral mide 260). Las filas miden 30 px en densidad «Normal», cuando DataGrip y SSMS usan 20–24 px.
- **Incumple:** la eficiencia para usuarios expertos (Nielsen H7) y la convención de densidad de los clientes de BD.
- **Impacto:** se ven menos datos que en la versión actual, en una herramienta cuyo valor es ver datos.
- **Recomendación:**
  - Fila de 24 px en Compacta y 28 px en Normal.
  - Fusionar las pestañas de resultados y la barra de resultado en una sola banda de 32 px.
  - Rail colapsable a 48 px o eliminado (R-18).
  - Explorador redimensionable (mínimo 180 px) y ocultable con `Ctrl+B`.
  - Modo «maximizar panel» (doble clic en la pestaña de resultados o `Ctrl+Shift+M`).

**R-24 · Formato de valores en la rejilla · Media**
- **Problema:** `DataGrid` muestra `saldo` como «1,250.00», con separador de miles y 2 decimales forzados; el valor real es 1250. Los booleanos aparecen como «sí/no»; el valor real es 1/0 o true/false. La coma de miles es la de es-MX; en es-ES sería punto y coma decimal.
- **Incumple:** Nielsen H2 (mostrar el dato real del sistema). DataGrip, DBeaver y TablePlus muestran el valor crudo, con el formato como opción.
- **Impacto:** al copiar, filtrar o comparar se usa un valor que no es el almacenado. Las coincidencias de «Buscar en la página» y los filtros rápidos («Filtrar: saldo = 1,250.00») son ambiguos.
- **Recomendación:**
  - Valor crudo por defecto.
  - Ajuste «Formatear números según la configuración regional», desactivado por defecto.
  - Booleanos como ☑ y ☐ más el literal (`true`), y copia siempre del valor crudo.

**R-25 · Presentación de NULL · Media**
- **Problema:** NULL es una pastilla de 10 px en color `--null`, igual al tenue (2,90–3,33:1), con un borde de 1,3:1. No hay una forma de distinguir una cadena vacía `''` de NULL.
- **Incumple:** WCAG 1.4.3. En los clientes de BD, NULL y vacío deben distinguirse (DBeaver `[NULL]`, DataGrip `<null>` en gris y cursiva).
- **Impacto:** NULL apenas se lee, y un vacío se confunde con NULL al revisar datos.
- **Recomendación:**
  - NULL en 11–12 px, `--text-dim` (≥ 4,5:1), cursiva, con la pastilla opcional.
  - Cadena vacía con un marcador `''` o «(vacío)» en dim.
  - Ajuste del texto que representa NULL.

**R-26 · Estados de cambio solo por color o al pasar el puntero · Media**
- **Problema:**
  - Las celdas editadas se marcan con un fondo ámbar suave y una línea de 2 px; el valor anterior solo aparece en el `title` («Antes: …»).
  - Las filas nuevas solo llevan un tinte verde del 10 %.
  - `rowState: 'changed'` no se dibuja (`Grid.body`).
  - En `ResultCompare` el valor anterior se ve «pasando el puntero sobre una celda cambiada».
- **Incumple:** WCAG 1.4.1 «Uso del color», 1.4.13 «Contenido al pasar el puntero o con foco» y 2.1.1 «Teclado».
- **Impacto:** con daltonismo o solo con teclado no se distingue qué cambió ni se ve el valor original.
- **Recomendación:**
  - Glifos en el margen: «+» para fila nueva, «~» para modificada, «−» para eliminada (ya se usan en el SQL de `GridPendingChanges`).
  - Celda modificada: valor nuevo más el valor anterior tachado en la línea siguiente en modo comparación, o en el panel de detalle.
  - Atajo para «ver valor anterior».

**R-27 · Tamaños de letra mínimos · Media**
- **Problema:**

  | Elemento | Tamaño |
  | --- | --- |
  | Etiquetas del Rail | 10 px |
  | Pastilla NULL | 10 px |
  | `.kbd` | 10 px |
  | Monogramas de motor | 10 px |
  | Insignia de notificaciones | 9 px |
  | `--fs-xs` (barra de estado, ayudas, chips) | 11 px |

- **Incumple:** las pautas de legibilidad de Fluent (12 px como cuerpo mínimo; Caption 12) y de macOS (11 pt mínimo). Combinado con R-09 empeora el contraste percibido.
- **Impacto:** fatiga y errores de lectura, sobre todo en pantallas de 96 dpi.
- **Recomendación:** mínimo 11 px para elementos decorativos o de apoyo, 12 px para el texto de ayuda y la barra de estado. Rail a 11 px. Insignia a 10 px en negrita como mínimo.

**R-28 · Tamaño de los objetivos de puntero · Media**
- **Problema:**
  - El cierre de pestaña mide unos 16 px y tiene `opacity: 0` en las pestañas inactivas (`DocTabs`).
  - «Limpiar filtro» mide 18 px y las muestras de color del formulario 20 px.
  - En las pestañas con cambios, el × desaparece y el punto no es un control (`aria-label` en un `span`).
- **Incumple:** WCAG 2.5.8 «Tamaño del objetivo (mínimo)» (24×24 px o espaciado equivalente) y Nielsen H6 (cerrar oculto).
- **Impacto:** cerrar pestañas exige precisión, y no se puede cerrar una pestaña con cambios sin pasar el puntero.
- **Recomendación:**
  - Área de cierre de 24×24 px. Cierre visible en la pestaña activa y a media opacidad en las demás.
  - Pestaña con cambios: el punto se convierte en × al pasar el puntero o con el foco (patrón de VS Code). Clic central para cerrar.
  - Muestras de color de 24 px.

**R-29 · Semántica ARIA de controles complejos · Media**
- **Problema:**
  - `role="tree"` con `<a role="treeitem">` sin `aria-expanded`, `aria-level` ni `tabindex` itinerante.
  - `role="grid"` sin `gridcell`, `aria-rowcount`, `aria-colcount` ni `aria-selected`, y está virtualizado.
  - Acciones hechas con `<a href="#">`.
  - Menús con `<a role="menuitem">`, segmentos con `<span role="radio">` no enfocables y cierre de pestaña en un `span`.
  - La paleta usa `onClick` en botones `role="tab"` sin flechas.
- **Incumple:** WCAG 4.1.2 «Nombre, función y valor», 2.1.1 «Teclado» y los patrones WAI-ARIA APG (Tree View, Grid, Menu, Tabs, Radio Group).
- **Impacto:** los lectores de pantalla no anuncian el nivel, el estado ni la posición, y la navegación por flechas depende de la implementación.
- **Recomendación:** documentar en el sistema de diseño los patrones APG para el árbol (flechas, Home/End, búsqueda al teclear, `*` expande), la rejilla (flechas, PageUp/Down, `Ctrl+Home`), el menú (flechas, Esc, `Shift+F10` y tecla Menú) y las pestañas. Usar `<button>` para las acciones y `<a>` solo para navegar.

**R-30 · Notificaciones · Media**
- **Problema:**
  - `Notifications` guarda un toast por cada ejecución («Ejecutada a las 14:16:02 · 11 ms»).
  - En `SafeModeReadonly` el mismo bloqueo se comunica tres veces: banda, mensaje y toast, con verbos distintos («bloqueada» y «Falló»).
  - Los toasts (340 px abajo a la derecha, a 36 px) tapan la esquina de la rejilla y su paginación.
  - No se define cuánto dura un toast de error.
- **Incumple:** Nielsen H8. WCAG 2.2.1 «Tiempo ajustable» (los errores no deben desaparecer solos) y 4.1.3 «Mensajes de estado».
- **Impacto:** fatiga de notificaciones, de modo que los avisos importantes se ignoran, y errores que desaparecen antes de leerse.
- **Recomendación:**
  - Sin toast cuando el resultado ya es visible en el documento activo. Usar toast solo para tareas en segundo plano (exportar, respaldo) o para lo que pasa en otra pestaña.
  - Los errores se quedan hasta que se cierran (`role="alert"`); el resto dura 5–8 s, con pausa al pasar el puntero.
  - Situarlos por encima de la paginación (`bottom: 64px`).
  - Usar un único verbo: «Bloqueada».

**R-31 · Acciones destructivas sin protección o mal colocadas · Media**
- **Problema:**
  - «Terminar sesión 4127» (`ServerMonitor`) es btn-danger directo, sin confirmación.
  - «Limpiar historial» (`HistoryPanel`) es ghost, sin confirmación ni deshacer.
  - «Eliminar tabla» es ghost en la barra de `StructureView`, junto a «Copiar DDL».
  - Eliminar una conexión (`ConnectionManager`) enlaza con el diálogo de DROP TABLE (`ConfirmDrop`).
  - «Revertir» la transacción tiene el mismo estilo que «Confirmar» (`TxManualPending`).
- **Incumple:** Nielsen H5 y H3, y las pautas de acciones destructivas de Windows y macOS (separar, confirmar, nombrar el objeto y permitir deshacer cuando se pueda).
- **Impacto:** clics accidentales con consecuencias en sesiones de Producción o en el historial personal.
- **Recomendación:**
  - Terminar sesión: confirmación con el PID, el usuario y la consulta.
  - Limpiar historial: confirmación o toast con [Deshacer] durante 10 s.
  - Eliminar tabla: solo en «Más» y en el menú contextual, en rojo y separado.
  - Eliminar conexión: diálogo simple «Eliminar la conexión guardada Ventas copia (no borra la base)».
  - Revertir con texto en `--danger`, y Confirmar como primario cuando hay una transacción abierta.

**R-32 · Terminología inconsistente · Media**
- **Problema:**

  | Concepto | Términos usados |
  | --- | --- |
  | Anular la transacción | «Revertir» (`TxControlsMenu`) / «Deshacer la transacción» (`ShortcutsHelp`) |
  | Salir de un asistente | «Cancelar» en el paso 1 / «Cerrar» en el paso 2 (`SchemaSync` → `SchemaSyncResult`) |
  | Volver a pedir los datos | «Refrescar» / «Volver a ejecutar» / «Analizar de nuevo» |
  | Añadir una fila | «Fila» / «Nueva fila» |
  | Tecla de confirmar | «Intro» (filtro) / «Enter» (resto) |
  | Teclas modificadoras | «Supr» en español junto a «Shift» en inglés (en Windows en español es «Mayús») |
  | Buscar | tres significados: la paleta, los datos y el editor |
  | «Más» | contenidos distintos en cada barra, y «Más» en el Rail |

- **Incumple:** Nielsen H4.
- **Impacto:** se aprende más despacio y aumenta la duda antes de actuar.
- **Recomendación:** un glosario en el sistema de diseño (Revertir, Cancelar antes de actuar / Cerrar después, Refrescar = volver a leer, Ejecutar = enviar SQL), las teclas con los nombres de Windows en español (Intro, Mayús, Supr, Re Pág, Av Pág) y en macOS los símbolos (⌘ ⇧ ⌥ ↩).

**R-33 · Notación de atajos · Media**
- **Problema:** se usan cuatro notaciones: «Ctrl K» (`TitleBar`, `ShortcutsHelp`), «Ctrl+C» (menús), «Ctrl ↵» (`Notebook`) y una tecla por `kbd` («Ctrl» «Enter») (`EditorEmpty`). Fuera de la ayuda nunca se muestra ⌘ para macOS (`TitleBar`, menús, tooltips).
- **Incumple:** Nielsen H4 y macOS HIG «Keyboard shortcuts» (símbolos ⌘⇧⌥⌃ en el orden ⌃⌥⇧⌘).
- **Impacto:** ruido visual, y en macOS atajos incorrectos.
- **Recomendación:** un único formateador por plataforma. Windows y Linux: `Ctrl+Mayús+F`, con «+» y sin espacios. macOS: `⇧⌘F`. Un solo `kbd` por combinación.

**R-34 · F5 sobrecargado · Media**
- **Problema:** F5 refresca el árbol y los datos (Explorador, barras) y además «Volver a ejecutar (F5)» en la barra de resultado del editor (`EditorResult`). En SSMS, F5 es «Ejecutar».
- **Incumple:** Nielsen H5 y la expectativa transferida de SSMS.
- **Impacto:** si el último resultado viene de un script con DML, F5 podría reenviar escrituras. Quien viene de SSMS espera que F5 ejecute la consulta.
- **Recomendación:**
  - F5 solo vuelve a leer, y únicamente consultas SELECT. Si la pestaña contiene escrituras, no hace nada y avisa.
  - Volver a ejecutar es `Ctrl+Enter`.
  - Ofrecer un perfil de teclado «SSMS» (F5 = ejecutar) en `SettingsShortcuts`.

**R-35 · Árbol de objetos · Media**
- **Problema:** `Explorer.body` presenta base › Tablas/Vistas/Triggers.
  - No hay nivel de esquema: con «Producción (PostgreSQL)» y SQL Server es imprescindible.
  - Las tablas no se expanden a columnas, claves e índices.
  - Solo cabe una conexión a la vez (hoy hay una sección por conexión abierta).
  - Los contadores usan faint.
- **Incumple:** la convención de DataGrip y DBeaver (conexión › base › esquema › tipo › objeto › columnas, claves e índices) y Nielsen H6.
- **Impacto:** en motores con esquemas el árbol no escala, y para mirar las columnas hay que abrir Estructura.
- **Recomendación:**
  - Nivel de esquema cuando el motor lo tiene, con el esquema por defecto expandido.
  - Las tablas se expanden a columnas (nombre, tipo, PK y FK) e índices.
  - Varias conexiones en el mismo árbol, cada una con su color (R-02, R-06).
  - Filtro con alcance «nombre» u «objeto + columnas».

**R-36 · Alcance de Exportar · Media**
- **Problema:** `ExportMenu` solo ofrece «Filas cargadas · 12» o «3 marcadas», sin opciones (separador, encabezados, codificación, texto para NULL, comillas). Con páginas de 1000 filas, exportar una tabla grande exporta solo la página sin avisar.
- **Incumple:** Nielsen H1 y H5. DBeaver, DataGrip y Navicat exportan la consulta completa con un asistente de formato.
- **Impacto:** exportaciones incompletas que parecen completas, y datos perdidos en informes.
- **Recomendación:**
  - Alcance «Toda la tabla / consulta (12 345 filas)», marcado por defecto cuando hay más de una página, más «Página cargada» y «Marcadas».
  - Enlace «Opciones…» para el separador, los encabezados, NULL, la codificación y el BOM.
  - Toast con el progreso y [Cancelar] (R-01).

**R-37 · Retomar la sesión · Media**
- **Problema:** en `RestoreSessionPrompt`, Esc equivale a «Empezar en blanco» y descarta las pestañas con SQL sin ejecutar. El × del encabezado no dice qué hace. La app actual se comporta igual.
- **Incumple:** la convención de que Esc nunca ejecuta una acción con pérdida (Windows y macOS: Esc = Cancelar, sin efectos) y Nielsen H3.
- **Impacto:** se pierde trabajo al pulsar Esc por reflejo nada más abrir la app.
- **Recomendación:**
  - Esc o × cierran el aviso sin descartar nada: la sesión queda disponible en Archivo › Retomar sesión anterior.
  - Botones [Retomar] (primario) y [Descartar pestañas], con un texto que lo deje claro.

### Bajos

**R-38 · Paginación · Baja**
- **Problema:** en el pie de `DataGrid` el selector es «‹ 1 ›», sin total de páginas, sin primera y última ni salto a página. «Filas por página 1000» parece un campo, pero es un `span`. No se sabe qué pasa en tablas con un recuento desconocido o caro.
- **Incumple:** Nielsen H1. DBeaver y DataGrip ofrecen «Recuento total» bajo demanda y botones de primera y última página.
- **Impacto:** navegar en tablas grandes es lento y no se sabe cuánto queda.
- **Recomendación:** `|‹ ‹ 3 / 125 › ›|` más «1 001–2 000 de 124 830 · [Contar]», y un campo de página editable.

**R-39 · Estilo C: minúsculas forzadas · Baja**
- **Problema:** `--label-case: lowercase` convierte toda `.lbl` a minúsculas, incluidas palabras clave y siglas. Por ejemplo, «WHERE» y «ORDER BY» en `DataFilterSql` salen como «where» y «order by», y también «SQL de migración» y los nombres propios.
- **Incumple:** la legibilidad y la exactitud técnica (H2).
- **Impacto:** las palabras clave pierden su forma reconocible, y el texto queda poco cuidado.
- **Recomendación:** marcar con `data-case="keep"` las etiquetas que contienen código o siglas, o aplicar la minúscula solo con `::first-letter`. No usar `.lbl` para palabras clave SQL.

**R-40 · Ajustes duplicados o peligrosos · Baja**
- **Problema:**
  - «Densidad» aparece en Apariencia y en Rejilla (`SettingsAppearance`, `SettingsGrid`).
  - Desmarcar «Barra de herramientas bajo las pestañas» (`SettingsWindow`) elimina la barra del documento, incluidos el botón Ejecutar y el selector de alcance: solo quedan el atajo y la paleta.
- **Incumple:** Nielsen H4 y H6.
- **Impacto:** no queda claro qué ajuste manda, y un usuario puede quedarse sin forma visible de ejecutar.
- **Recomendación:** una sola «Densidad» (en Apariencia) que afecte a todo. Con la barra oculta, mantener una barra mínima con [▶] [conexión ▾] y Más, o pasarlos a la cabecera de pestañas.

**R-41 · Barra de menús integrada · Baja**
- **Problema:** los menús de `TitleBar` no tienen teclas de acceso (`Alt+A` para Archivo, letras subrayadas al pulsar Alt) ni se activan con F10. «Ayuda» no es un menú: enlaza directamente con Atajos, sin «Documentación», «Buscar actualizaciones», «Informar de un problema» ni «Acerca de».
- **Incumple:** la convención de Win32 (teclas de acceso, Alt/F10 activa la barra) y la de macOS y GNOME (Acerca de en el menú de la app o en Ayuda).
- **Impacto:** se pierde la navegación por menú solo con teclado, y faltan entradas estándar.
- **Recomendación:** teclas de acceso en todos los menús (Archivo, Editar, Ver, Consulta, Herramientas, Ventana, Ayuda), F10 o Alt para enfocar la barra, y un menú Ayuda completo.

**R-42 · Semántica de los chips de estado · Baja**
- **Problema:**
  - La barra de estado pinta «Edición · sin cambios» en ámbar, que es el color de aviso (`GridEditMode`).
  - El chip TX en ámbar sobre chrome da 4,35:1 en B y 3,64:1 en Rosa.
  - «Solo lectura» da 4,18:1 en B.
  - En Rosa, `--warn` sobre warn-soft da 4,12:1 y la selección del árbol 4,39:1.
- **Incumple:** WCAG 1.4.3 y H4 (el ámbar debería significar «atención»).
- **Impacto:** se avisa sin motivo, y los textos de los chips no se leen bien en dos estilos.
- **Recomendación:**
  - «Edición» en neutro hasta que haya cambios.
  - Un token `--warn-text` para los chips: B `#8f4400` (5,96:1 sobre chrome), Rosa `#9a4520` (5,48:1).
  - En Rosa, un `--accent-text` de `#9a3060` para la selección (5,99:1).

**R-43 · Fuentes · Baja**
- **Problema:** el helmet carga Geist, IBM Plex y Figtree desde Google Fonts, cuando la app es de escritorio y debe funcionar sin conexión. El estilo B depende de «Segoe UI Variable», que no existe en Linux ni en macOS, así que la métrica cambia por sistema y los anchos de 1280 px pueden romperse.
- **Incumple:** la robustez sin conexión y la consistencia entre plataformas.
- **Impacto:** saltos de diseño y texto cortado según el sistema operativo.
- **Recomendación:** incluir las fuentes en la app (WOFF2) con subconjunto latino. En el estilo B, usar la fuente de cada sistema (Segoe UI Variable, SF Pro, Cantarell o Ubuntu) y validar los artboards con las tres métricas.

---

## Contraste por estilo

Ratios WCAG calculados con los tokens de `theme-helmet.txt`. Los colores con alfa se mezclan sobre el fondo real. Umbrales: texto 4,5:1; elementos no textuales (bordes de control, foco) 3:1.

| Par (uso) | Umbral | B · Nativo | A · Quiet pro | C · Editorial | Rosa |
|---|---|---|---|---|---|
| text / content | 4,5 | 16,56 ✅ | 15,43 ✅ | 14,83 ✅ | 13,73 ✅ |
| text-dim / content | 4,5 | 6,18 ✅ | 6,84 ✅ | 7,03 ✅ | 6,12 ✅ |
| text-dim / chrome (Explorador, barra de estado) | 4,5 | 5,25 ✅ | 7,00 ✅ | 7,32 ✅ | 5,35 ✅ |
| text-dim / chrome-2 (tarjeta de conexión) | 4,5 | 4,87 ✅ | 6,56 ✅ | 6,83 ✅ | 4,88 ✅ |
| text-faint / content (número de fila, orden) | 4,5 | 3,11 ❌ | 3,33 ❌ | 3,20 ❌ | 2,90 ❌ |
| text-faint / chrome (contadores del árbol, subtítulos) | 4,5 | 2,65 ❌ | 3,41 ❌ | 3,33 ❌ | 2,54 ❌ |
| text-faint / overlay (atajos `.mi .k`) | 4,5 | 3,11 ❌ | 2,94 ❌ | 2,92 ❌ | 3,00 ❌ |
| null / content (NULL) | 4,5 | 3,11 ❌ | 3,33 ❌ | 3,20 ❌ | 2,90 ❌ |
| syntax-comment / content | 4,5 | 3,11 ❌ | 3,33 ❌ | 3,20 ❌ | 2,90 ❌ |
| syntax-keyword / string / number | 4,5 | 6,78 / 5,38 / 5,87 ✅ | 7,46 / 10,82 / 9,71 ✅ | 8,35 / 9,76 / 9,54 ✅ | 5,50 / 4,83 / 4,69 ✅ |
| accent-fg / accent (botón primario) | 4,5 | 5,13 ✅ | 7,03 ✅ | 8,22 ✅ | 4,69 ✅ (justo) |
| accent-text / content (enlaces) | 4,5 | 6,37 ✅ | 10,09 ✅ | 10,13 ✅ | 5,82 ✅ |
| accent-text / sel sobre chrome (selección del árbol) | 4,5 | 4,65 ✅ | 8,09 ✅ | 8,40 ✅ | 4,39 ❌ |
| accent-text / accent-soft (seg `.on`, chips) | 4,5 | 5,56 ✅ | 8,13 ✅ | 7,94 ✅ | 4,97 ✅ |
| danger-fg / danger (botón de peligro) | 4,5 | 5,52 ✅ | 6,40 ✅ | 5,92 ✅ | 5,95 ✅ |
| danger / danger-soft sobre chrome (chip «Solo lectura») | 4,5 | 4,18 ❌ | 5,82 ✅ | 5,14 ✅ | 4,49 ❌ (justo) |
| warn / warn-soft sobre chrome (chip TX) | 4,5 | 4,35 ❌ | 8,15 ✅ | 6,23 ✅ | 3,64 ❌ |
| warn / warn-soft sobre content | 4,5 | 5,08 ✅ | 7,88 ✅ | 5,90 ✅ | 4,12 ❌ |
| ok / ok-soft sobre content (chips correctos) | 4,5 | 4,69 ✅ | 8,76 ✅ | 7,78 ✅ | 4,25 ❌ |
| border-strong / content (borde de campo o botón) | 3,0 | 1,56 ❌ | 1,54 ❌ | 1,50 ❌ | 1,55 ❌ |
| border-strong / chrome (filtro del Explorador) | 3,0 | 1,32 ❌ | 1,57 ❌ | 1,57 ❌ | 1,36 ❌ |
| halo de foco accent-soft / content | 3,0 | 1,14 ❌ | 1,24 ❌ | 1,28 ❌ | 1,17 ❌ |
| accent / content (borde de foco o contorno propuesto) | 3,0 | 5,13 ✅ | 7,73 ✅ | 8,35 ✅ | 4,54 ✅ |
| accent / chrome (indicador del Rail, contorno en el chrome) | 3,0 | 4,36 ✅ | 7,91 ✅ | 8,69 ✅ | 3,97 ✅ |
| type-dot-* / surface (peor de los 4) | 3,0 | 5,51 ✅ | 6,49 ✅ | 6,76 ✅ | 4,41 ✅ |

**Resultado por estilo:**
- **B · Nativo:** 10 fallos. Falla todo el texto tenue, NULL, los comentarios SQL, los chips TX y «Solo lectura» sobre chrome, los bordes de control y el halo de foco.
- **A · Quiet pro:** 8 fallos. Falla el texto tenue, NULL, los comentarios, los bordes y el halo.
- **C · Editorial:** 8 fallos. Los mismos que A.
- **Rosa:** 13 fallos, el más débil. A lo anterior suma la selección del árbol, los chips de aviso, éxito y «Solo lectura», y su primario va justo (4,69).

**Valores corregidos propuestos:** los de R-09, R-10 y R-42. Con ellos, todos los pares de la tabla cumplen.

---

## Fortalezas que conviene mantener

1. **Un solo lenguaje de componentes y tokens.** Hay una sola gramática (barra de documento, `.btn`, `.seg`, `.menu`, `.dlg`, minúscula inicial) y los cuatro estilos son solo temas: corregir un token arregla toda la app.
2. **Panel de error ejemplar (`EditorError`).** Un mensaje en lenguaje llano («No existe la columna «telefono»») que dice que no se modificó nada, con un enlace a la línea y la columna, el texto original del motor, las columnas válidas de la tabla y «Copiar error», más el subrayado en el editor y un tooltip. Cumple H9 de libro.
3. **Capacidades honestas.** Chips «No en SQLite» en Herramientas, acciones deshabilitadas con su motivo («Poner NULL · requiere modo edición», «Datos relacionados: ninguna tabla referencia a ciudad») y chips de solo lectura que explican la causa («resultado de un JOIN», «el script tiene varias sentencias»).
4. **Escrituras revisables.** `GridPendingChanges` muestra el SQL exacto (~/−/+) y «en una sola transacción». `TxManualPending` lista las sentencias de la transacción. `EditorDmlResult` sugiere pasar a transacción manual. `SafeModeReadonly` bloquea antes de enviar y lo dice.
5. **`ConfirmDrop` bien resuelto.** Cuantifica lo que se pierde (12 filas, 2 índices), avisa de las dependencias (`pedidos.cliente_id`), enseña el SQL y pide escribir el nombre. Es un patrón que vale para todo lo destructivo.
6. **Asistentes uniformes.** Pasos numerados, Atrás / Siguiente / Cancelar en el orden de Windows, vista previa del origen, «Asignar por nombre», ejemplos por columna, política «si una fila falla» y el verbo con la cantidad en el primario («Importar 2 filas», «Generar 10 filas»).
7. **Paleta y atajos.** Paleta con ámbitos (Tab cambia de ámbito) y atajos en cada resultado. `ShortcutsHelp` con búsqueda y conmutador Windows/Linux ↔ macOS. `SettingsShortcuts` con captura, detección de conflictos y la etiqueta «Fijo» o «Personalizado».
8. **Formulario de conexión.** Índice de secciones con estado (completa, incompleta o apagada), vista previa y prueba de conexión a la vista, ayudas claras para SSL/TLS y SSH (TOFU) y el segmento «Protección» con su consecuencia explicada.
9. **Estados vacíos accionables.** `ConnectedNoTab`, `EditorEmpty` y `Welcome` ofrecen una acción principal, tablas y consultas recientes, snippets y atajos, sin ilustraciones de relleno.
10. **Rail con etiquetas y barra de estado limpia.** Sustituye los 12 iconos sin texto de la versión actual, y la barra de estado separa el contexto (izquierda) de los datos (derecha).

---

## Prioridad sugerida

1. **Antes de implementar el shell:**
   - R-01 (ejecución y cancelación), R-02 y R-06 (contexto y color de conexión), R-04 (alcance de Ctrl+Enter).
   - R-03, R-09 y R-10 (foco y contraste; son cambios de tokens).
   - R-05 (desconectar).
2. **Antes de cerrar el diseño de la rejilla y del objeto:**
   - R-11 y R-12 (barras y conmutador de vistas).
   - R-13, R-14 y R-16 (tipos, edición y selección).
   - R-15 y R-31 (acciones destructivas).
3. **Pase de consistencia:** R-08, R-17, R-19, R-20, R-32, R-33 y R-34.
4. **Pulido:** el resto.
