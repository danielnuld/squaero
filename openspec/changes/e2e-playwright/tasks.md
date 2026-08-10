## 1. El arnés

- [x] 1.1 Playwright como `devDependency` de `frontend/`, `playwright.config.ts` y
      script `pnpm e2e`. `webServer` levanta `vite preview` sobre `dist/`, y
      `workers: 1` con el comentario `ponytail:` que nombra el techo.
- [x] 1.2 `e2e/support/rpc.ts`: proceso hijo `quaero-rpc`, una petición JSON por
      línea, respuestas **correlacionadas por `id`** (no por orden: `op.cancel` no
      se encola detrás de la consulta en curso). Si el proceso muere, las promesas
      pendientes se rechazan con motivo en vez de quedarse colgadas.
- [x] 1.3 Elección de binario por `QUAERO_RPC`/`QUAERO_DRIVERS` y el runtime de
      mingw añadido al `PATH` del hijo por el arnés, que además registra qué drivers
      cargó.
      **Un solo binario, el x86: es la arquitectura que se publica.** Llegué a
      montar un binario por motor porque el x86 no podía con MySQL 8, y eso estaba
      mal: habría dejado la suite verde mientras un usuario real no podía conectar.
      El arreglo era del build, no del arnés (ver 4.6), así que el `CorePool` y la
      selección por motor se borraron.
- [x] 1.4 `e2e/support/bridge.ts`: `page.exposeFunction` + `addInitScript` que
      asigna `window.quaeroRpc`, imitando el contrato de `transport.ts`.
- [x] 1.5 `e2e/support/state.ts`: siembra de `localStorage` (conexiones, `locale`,
      y las demás claves `quaero.*`) para que ninguna prueba herede estado.
- [x] 1.6 `e2e/support/engines.ts`: la matriz de motores con su DSN y su DDL de
      fixture. SQLite, PostgreSQL, MySQL e Informix.
- [x] 1.7 `globalSetup`: sondear cada motor (¿cargó el driver? ¿contesta la base?) y
      publicar la disponibilidad. Los no disponibles se saltan **con motivo**, y el
      mensaje incluye el comando para arrancar el contenedor.
- [x] 1.8 `QUAERO_E2E_REQUIRE`: convierte el salto en fallo para los motores
      listados, de modo que un CI verde no pueda significar «no se probó nada».
- [x] 1.9 Siembra por el núcleo, resembrando por fichero de pruebas, con los
      valores de #323/#324: acentos, la fila `C3 B1` y las de bytes 0x80–0x9F.
- [x] 1.10 Trazas y capturas al fallar, y `README.md` en `e2e/`: cómo correrla, cómo
      levantar los contenedores, cómo añadir un motor y cómo añadir un caso.
- [x] 1.11 Prueba del propio arnés: que un motor inexistente se salta y no falla, y
      que con `QUAERO_E2E_REQUIRE` sí falla. El arnés también es código.

## 2. Camino crítico por motor (fase 1)

- [x] 2.1 Conectar desde una conexión guardada: el pie deja de decir «Sin conexión»,
      la fila pasa a «conectado» y las acciones de objeto se habilitan.
- [ ] 2.2 Crear una conexión **rellenando el formulario**, que sobreviva a una
      recarga. Es el primer camino de cualquier usuario nuevo y no puede quedar
      cubierto sólo por siembra.
- [x] 2.3 Árbol de objetos: la tabla de fixture aparece expandiendo la ruta del
      motor. **La forma del árbol difiere de verdad**: Postgres mete un nivel de
      esquema (`testdb` → `public` → Tablas) y SQLite llama `main` a su único
      esquema, así que la ruta se declara en la matriz de motores.
- [x] 2.4 Columnas con su tipo: la cabecera del grid las nombra (`id int`,
      `nombre text`), que es el «describe» que ve un usuario al abrir la tabla.
- [x] 2.5 **Paginación real**, ya no la versión que fingía. El grid pagina a 1000
      filas, así que el caso hace crecer la tabla él mismo: `bulk` en la matriz añade
      1200 filas **en una sentencia** por motor, porque no hay generador portable —
      PostgreSQL tiene `generate_series`, SQLite y MySQL CTE recursiva (a MySQL hay
      que subirle el tope de recursión, que por defecto es 1000), e Informix no tiene
      ninguno, así que cruza `systables` consigo misma y saca un id único de los dos
      `tabid`. Sólo esta prueba paga ese coste, y la resiembra por prueba lo deshace.
      Se asserta que **la ventana de filas se mueve** (`Filas 1–1000` →
      `Filas 1001–`): es lo que prueba que el offset se aplicó de verdad, porque una
      página que reejecutara la misma consulta también se vería llena.
- [x] 2.6 Sentencia rechazada: llega el mensaje del motor y la interfaz sigue
      usable — una consulta buena después funciona.
- [ ] 2.7 Edición transaccional: insert + update + delete + commit, verificado
      releyendo.
- [ ] 2.8 Rollback: el cambio no queda.
- [ ] 2.9 Export del resultado: el contenido lleva las mismas filas y valores.
- [x] 2.10 Desconectar: vuelve «Sin conexión» y las acciones se deshabilitan.
- [x] 2.11 Encoding: valor acentuado y la fila discriminadora, por valor **exacto**,
      más que `ñ` NO aparezca donde el dato es `Ã±`. Y filtrar por un valor acentuado
      devolviendo sus filas.
      **Postgres marcado como fallo esperado**: en x86 no convierte (ver 4.7).
- [x] 2.12 **Tres huecos de accesibilidad encontrados al escribir las pruebas.** Van
      como trabajo sobre el componente, no como `data-testid`: un testid sólo lo ve
      la prueba, una etiqueta la ve también el usuario.
      - **`ObjectTree`** — **ARREGLADO.** Ahora es un `role="tree"` de `treeitem`
        con `aria-label`, `aria-level`, `aria-expanded` y `aria-selected`, navegable
        con flechas / Home / End / Enter. El foco se queda en el contenedor y la fila
        activa se publica con `aria-activedescendant`: es la mitad del patrón ARIA
        que **sobrevive a la virtualización**, porque las filas se reciclan al
        desplazar y un elemento enfocado puede destruirse bajo los pies del usuario.
        Con estilo visible (`.is-focused`), que sin él sería un cursor invisible.
      - **`SqlEditor`**: sigue sin nombre accesible (fuera del alcance de este
        arreglo, que era grid y árbol). Es una línea, y quitaría el último
        localizador por clase CSS que queda en `app-actions.ts`.
      - **`ResultGrid`** — **ARREGLADO.** `role="grid"` con `aria-rowcount` /
        `aria-colcount` **totales** (no lo que renderiza la ventana virtual: para eso
        existen `aria-rowindex`/`aria-rowcount`), filas `role="row"` con su
        `aria-rowindex` absoluto, celdas `role="gridcell"`, y cabeceras
        `role="columnheader"` con `aria-sort`. Y lo que mató los localizadores
        posicionales: **las celdas editables llevan `aria-label` con el nombre de su
        columna**.
        Un detalle que corregí a mitad: puse `role="gridcell"` en el propio `<input>`
        y eso **anula su rol de textbox**, así que un lector de pantalla dejaría de
        anunciarlo como editable — peor para el usuario que el hueco original. El
        `<input>` se queda con su rol y sólo lleva la etiqueta.
        **Seguimiento cerrado**: la celda editable ya va envuelta en un
        `role="gridcell"` de verdad, con el input dentro conservando su rol de
        textbox. No hizo falta inventar nada: el propio código ya usaba esa forma
        para el selector de claves ajenas (`rootClass="grid-cell cell-fk"` con
        `class="cell-input"` dentro), así que se replicó. `data-cell` pasa al
        envoltorio, que es donde ya lo ponía FkPicker, y el ayudante de foco lo
        soportaba de antemano. Con una prueba que exige **los dos** roles a la vez:
        la celda como `gridcell` y el control como `textbox` editable con el nombre
        de su columna.

- [x] 2.2 Crear una conexión **rellenando el formulario**, que sobreviva a una
      recarga y se pueda abrir. Las etiquetas de los campos se leen de
      `DRIVER_SCHEMAS`, el propio código de producción, así que renombrar una etiqueta
      no puede dejar la prueba asertando un texto que la interfaz ya no muestra.
      **El formulario nunca estuvo roto: lo estaba el arnés.** `seedBrowserState`
      sembraba con un `addInitScript`, y eso corre en **cada navegación**, así que el
      `page.reload()` de la prueba borraba las claves `quaero.*` — incluida la
      conexión que acababa de crear. Una prueba de persistencia que destruía lo que
      iba a comprobar. Ahora la siembra ocurre sólo en la primera carga, con un
      centinela en `sessionStorage`: sobrevive a una recarga dentro de la pestaña y
      muere con ella, así que la prueba siguiente sigue empezando limpia.
      Y mi diagnóstico anterior («pulsar Guardar deja la lista vacía sin error») era
      **falso**: lo leí de un artefacto de la primera ejecución, cuando un
      `selectOption` con una expresión regular expiraba antes de rellenar los campos.
      Segunda vez en esta sesión que concluyo de un artefacto viejo.

- [x] 2.7 Edición: editar una celda, ver el contador de cambios pendientes, y que la
      confirmación **muestre el SQL exacto** (`UPDATE … WHERE "id" = '1'`) antes de
      aplicarlo. Verificado releyendo de la base, no del grid: que el grid muestre un
      valor no prueba nada sobre lo que se confirmó.
      Requisito que salió a la luz: el fixture necesitaba **clave primaria**, sin ella
      el grid abre «Solo lectura» y esto no podría ejecutarse.
- [x] 2.8 Descartar: la base queda intacta.
      **Destapó un defecto del arnés**: resembrar en `beforeAll` dejaba que la prueba
      de commit contaminara esta, y en Informix la transacción abierta que quedaba
      bloqueaba el `DROP TABLE` de la siembra siguiente. Ahora se resiembra por prueba
      y el puente **lleva la cuenta de las conexiones que abre la página** para
      cerrarlas (con rollback) al terminar. El aislamiento es cosa del arnés, no de
      que cada prueba se acuerde.
- [x] 2.9 Export a CSV con los acentos intactos, incluida la fila discriminadora.
      Chromium ofrece la File System Access API y la app la prefiere, lo que abre un
      diálogo nativo que ninguna automatización conduce; la prueba la retira para
      forzar el camino de respaldo documentado. El diálogo nativo pertenece a la
      superficie de la shell, que esta vía no cubre.

## 3. Fases siguientes, por área (a priorizar, no comprometidas)

Agrupadas por afinidad, para poder tomar una fase entera sin volver a inventariar
los 44 componentes de `frontend/src/components`.

- [ ] 3.1 **Editor y ejecución**: `SqlEditor` (selección, sentencia bajo el cursor,
      formateo, autocompletado), `CommandPalette` (Ctrl+K y Ctrl+J), atajos y
      `ShortcutsHelp`, cancelación de consulta (`op.cancel`, el caso que obliga a
      correlacionar por `id`).
- [ ] 3.2 **Resultados**: `ResultGrid` (navegación por teclado, orden, selección,
      columnas), `RowDetail`, `ChartView`, `ExplainPlan`, `StatusBar`.
- [ ] 3.3 **Exploración de esquema**: `ObjectTree`, `ObjectListView`,
      `ObjectToolbar`, `StructureView`, `InfoPane`, `ErDiagram`, `FkBrowser`,
      `FkPicker`, `RelatedData` (el modal de #310).
- [ ] 3.4 **Edición de datos y DDL**: `TableDesigner`, `IndexManager`,
      `DataGenerator`, `RoutineExplorer`, `TriggersExplorer`, refresco del árbol
      tras DDL (la regresión de #319).
- [ ] 3.5 **Import/export y trasvase**: `ImportWizard`, exportadores (CSV, JSON,
      XLSX, HTML), `Notebook` y su export, `TransferWizard`.
- [ ] 3.6 **Wizards de comparación**: `DataDiffWizard`, `SchemaSyncWizard`.
      Los más caros de cubrir y los que más se agradecen: nadie los prueba a mano.
- [ ] 3.7 **Multi-conexión**: varias conexiones abiertas a la vez, pestañas atadas a
      la suya, color por conexión, franja de acento del área de trabajo.
- [ ] 3.8 **Persistencia y preferencias**: historial, snippets (#320/#321),
      `SettingsPanel`, tema y skin «Azul», `ConnectionManager`, import/export de
      conexiones.
- [ ] 3.9 **Administración**: `UserManager`, `ServerMonitor`, `SlowQueries`.
      Dependen del motor y de permisos; conviene decidir qué se prueba y con qué
      usuario antes de escribir nada.
- [ ] 3.10 **i18n**: la interfaz en inglés y en español, incluido que ninguna
      cadena quede sin traducir en los caminos cubiertos.
- [ ] 3.11 **MongoDB**: contenedor y entrada en la matriz.
- [ ] 3.12 **La shell nativa**, lo único que esta vía no alcanza: smoke por CDP
      contra el ejecutable real (ventana, menús, diálogos de fichero, persistencia
      de `localStorage` por origen, `UpdateModal`, enlaces externos). Decidir si
      merece la pena con la fase 1 ya hecha y medida.
- [ ] 3.13 **CI**: servicios de Postgres y MySQL, `QUAERO_E2E_REQUIRE` con los tres
      motores que sí caben, y decidir —midiendo, no adivinando— si entra en la
      puerta o queda nocturna. Informix se queda fuera por su ODBC de 32 bits.

## 4. Cierre de la fase 1 (grupo 1 cerrado; del grupo 2 faltan 2.2 y 2.7–2.9)

- [x] 4.1 La suite del arnés pasa en verde con los cuatro motores listos
      (sqlite, postgres, mysql, informix), y se salta limpiamente los que no:
      verificado apuntando a un directorio de drivers vacío (4 saltados, 5 pasados)
      y con `QUAERO_E2E_REQUIRE=sqlite` (1 fallo con mensaje accionable).
- [x] 4.2 Dos ejecuciones seguidas, sin limpiar nada entre ellas, dan 9 pasadas las
      dos veces: no se arrastra estado.
- [x] 4.3 `ctest` verde y ninguna línea de producción tocada.
      **`pnpm test` tiene un fallo ajeno**: `tests/tools/packIcons.test.ts` da
      `SyntaxError` al importar `assets/icons/pack-icons.mjs`. Comprobado en un
      worktree limpio en `d450855` con instalación nueva: **ya fallaba antes**, y
      sólo en local (la pata `frontend` de CI pasa). Su propio issue, no de aquí.
- [x] 4.4 Ampliar `.rules/testing.md` con la sección de E2E y cómo correrla.
- [x] 4.5 El arnés tarda ~40 s de reloj (incluye compilar el frontend y sondear los
      cuatro motores); las 9 pruebas en sí, ~7 s. Dato para decidir 3.13 cuando la
      fase 2 esté escrita.

- [x] 4.6 **Arreglado el defecto que encontró el arnés en su primera ejecución**: el
      build x86 —la arquitectura que se publica— no podía autenticarse contra un
      MySQL 8 con configuración por defecto, porque `caching_sha2_password` (la
      autenticación por defecto desde 8.0) se compilaba como DLL aparte que no
      empaquetamos. `WITH_SSL=OFF` no era el motivo: en Windows el connector saca su
      criptografía de WinCrypt, en una rama que va **antes** de consultar
      `WITH_SSL`. Basta forzarlo a estático en `cmake/QuaeroMariaDB.cmake`, y de
      paso `sha256_password`. Verificado en vivo contra MySQL 8.4 con x86, y smoke
      12/12.

- [x] 4.7 **CORRECCIÓN: el «segundo defecto» no existía.** Di por bueno que en x86
      libpq ignoraba `client_encoding=UTF8` porque `SHOW client_encoding` respondía
      `LATIN1`. La causa real: **el `postgres.dll` staged era del 08-04 y nunca se
      recompiló** tras el cambio del PR #325. Recompilado, x86 devuelve `UTF8`,
      `Ã±` y `Cd. Obregón` correctos, y el `WHERE` acentuado encuentra su fila. Los
      dos `test.fail()` retirados. El arreglo del PR #325 siempre estuvo bien.

- [x] 4.8 **El defecto real era del arnés: confiaba en artefactos obsoletos.**
      `support/freshness.ts` compara la fecha de cada binario staged con la de sus
      fuentes y **aborta la ejecución** nombrando qué recompilar. Al activarlo cazó
      algo peor que el falso fallo de 4.7: **el `quaero-rpc.exe` del x86 era más
      antiguo que `core/`**, o sea que la red UTF-8 del grupo 2 nunca se había
      compilado ahí y la suite llevaba rato dando verde sobre un núcleo sin ella.
      Un falso fallo cuesta una tarde; un falso verde se cree.
      Verificado en las dos direcciones: con una fuente tocada aborta con la lista,
      y tras recompilar el x86 completo pasan las 41.

- [x] 4.9 Cazada una cuarta suposición posicional: `nombreCell` usaba «el último
      textbox», y en Informix el editor CodeMirror —que es un `contenteditable` con
      rol textbox— se renderiza después del grid, así que la aserción moría con «Not
      an input element». Acotado a `<input>` de verdad. Las cuatro veces han sido
      variantes de lo mismo, y es el argumento concreto para que el grid exponga
      roles de celda (2.12). Verificado con dos pasadas seguidas en verde.

- [x] 4.10 Los localizadores del e2e reescritos sobre los roles nuevos: el árbol por
      `getByRole("treeitem", { name })` en vez del `title` de la fila, y la celda por
      `getByRole("textbox", { name: "nombre" })` en vez de adivinar posiciones. Las
      cuatro suposiciones posicionales que fallaron eran **la misma etiqueta que
      faltaba**. Añadido `a11y-keyboard.spec.ts`: llegar a la tabla y abrirla **sólo
      con teclado**, colapsar y salir con flecha izquierda, y que los roles digan lo
      que prometen (incluido que el grid reporte el total de filas, no lo que
      renderiza la ventana virtual). 56 pruebas en verde.
