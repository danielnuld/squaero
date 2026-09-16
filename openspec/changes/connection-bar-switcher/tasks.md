# Tareas

Una fase = un PR. Cada fase queda en verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente. Plano: artboard «Prototipo · conexiones y
rejilla» (opción A) del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2.

## 1. Lógica pura (fase A)

- [x] 1.1 `utils/connections.ts`: `engineMonogram(driver)` (MY, PG, MS, IFX, MG,
      SQ, `DB` por defecto) y `connectionTarget(conn)` (host+puerto, `path` en
      SQLite, `server` en Informix) — el destino también nombra la **instancia**
      de SQL Server, y pone la base delante (`ventas @ 10.0.4.12:3306`)
- [x] 1.2 `utils/connectionSearch.ts`: `matchesConnection` por nombre, motor,
      servidor y grupo, sin distinguir mayúsculas **ni acentos** (NFD + quitar
      diacríticos). Varios términos **estrechan**: «ventas dev» exige los dos
- [x] 1.3 `searchGroups(conns, query, openIds, labelOf)`: grupos en el orden de
      `groupConnections`, cada entrada con `isOpen` y con el `target` que la fila
      de la barra muestra, para que lo que se ve y lo que se busca no divergan
- [x] 1.4 Pruebas: monogramas de los seis motores, sus alias y uno desconocido;
      destino de cada motor (Informix con `server`, SQL Server con `instance`,
      SQLite con `path`, campos ausentes y con espacios); «Nómina» encontrada
      escribiendo «nomina» y al revés; mayúsculas; motor por etiqueta y por
      nombre de driver; puerto; consulta vacía devuelve todo; términos que
      estrechan; sin coincidencias devuelve lista vacía; una abierta aparece
      marcada; no se muta la lista recibida

## 2. La barra como lista de abiertas (fase B)

> **Secuencia.** La barra es hoy el único camino para conectar, así que esta fase
> **conserva el desplegable con el gestor** detrás de un botón `+`: si el
> buscador no llegara hasta la fase C, entre los dos PR no habría forma de abrir
> una conexión. La fase C sustituye el contenido de ese desplegable por el
> buscador y muda el gestor a su pestaña.
>
> **Desviación del diseño:** las filas **no** son `listbox`/`option`. Cada fila
> lleva sus propios botones (desconectar, reconectar), y meter botones dentro de
> un `option` es peor que no tener `listbox`: es una lista con un botón por fila
> y `aria-current` en la enfocada.

- [x] 2.1 `ConnectionBar` reescrito: una fila por conexión abierta con raya de
      color, monograma, nombre y destino; la enfocada marcada; `listbox`/`option`
      con `aria-selected` y flechas — **hecho como lista con un botón por fila y
      `aria-current`**, por el motivo de arriba; el recorrido con flechas se
      queda fuera (las filas son paradas de tabulación normales)
- [x] 2.2 Clic en una fila enfoca (nunca abre ni cierra); desconectar y
      reconectar por fila; aviso de sesión caída (#407) en la fila. Desconectar
      va **nombrado** («Desconectar Local»), como en #444: tres botones iguales
      no dicen cuál cierran
- [x] 2.3 Estado sin conexiones abiertas: lo dice y ofrece el buscador — de
      momento abre el desplegable del gestor, que es lo que hay hasta la fase C
- [x] 2.4 Lista con scroll propio y altura máxima por encima de cinco filas, para
      no comerse el explorador
- [x] 2.5 `App.tsx` le pasa las abiertas ya resueltas y los cuatro callbacks; la
      cabecera de sección (#444) se queda como está, sin duplicar acciones. La
      segunda línea la arma `App` con `connectionTarget` de la conexión
      **guardada**, que es donde vive el DSN
- [x] 2.6 Pruebas de componente: tres abiertas con la enfocada marcada, enfocar
      no cierra, desconectar la enfocada pasa el foco a otra, fila sin color, y
      la fila caída ofrece reconectar — 15 casos, incluidos el contador, las
      acciones desactivadas mientras se abre otra conexión, y los dos casos del
      desplegable que se conservan (lista reactiva y `openTick`)

## 3. Buscador y pestaña del gestor (fase C)

- [x] 3.1 Desplegable del `+`: `role="dialog"`, campo enfocado al abrir, filtra
      con `searchGroups`, marca las abiertas, ↑/↓ + Enter, Escape y clic fuera
      cierran
- [x] 3.2 Elegir una cerrada la abre y la enfoca; una ya abierta solo la enfoca;
      sin coincidencias lo dice
- [x] 3.3 Pie del desplegable: nueva conexión, importar y gestionar — importar
      **lleva a la pestaña**, que es donde vive el selector de ficheros, en vez
      de duplicar un segundo `input` oculto en el buscador
- [x] 3.4 `ToolKind` += `connections`, en `GLOBAL_TOOLS` y en `TOOL_CATALOG`;
      `ConnectionManager` pasa a ser el contenido de la pestaña, sin conectar.
      El toolstrip y la paleta dejan de exigir conexión para las herramientas
      **globales**: esta pestaña se abre justamente cuando no hay ninguna
- [x] 3.5 Retirar `connbarOpenTick` y su efecto. El riesgo que anotaba el diseño
      **se cumplió**: sin el tic, guardar cerraba el formulario sin confirmar
      nada, porque la barra solo lista las **abiertas**. Guardar ahora deja la
      pestaña del gestor delante, donde la conexión nueva sí se ve
- [x] 3.6 Pruebas: 12 de `ConnectionSearch` (motor, servidor, acentos, abierta vs
      cerrada, ↑/↓ con vuelta, Enter, Escape, ratón y teclado comparten resalte,
      pie) y las de la barra reescritas al buscador; en `ConnectionManager` se
      conservan exportar con aviso e importar de DBeaver con dos ficheros
- [x] 3.7 **Defecto encontrado por las pruebas**: al hacer que toda la fila
      edite, la fila y el lápiz quedaron con el mismo nombre accesible
      («Editar»), dos por fila. La fila pasa a nombrarse con su conexión
      (`conn.editName`), como el desconectar de la fase B

## 4. Estilos, temas e idioma

- [x] 4.1 CSS con los tokens de las escalas y sin transiciones, con la guardia de
      `tests/styles.test.ts` en verde: ningún color literal, ninguna variable
      inexistente y AA en los tres temas con superficies propias. **La revisión a
      ojo de los cinco temas se hace en 5.4**, que es donde hay ventana: lo que
      la guardia no mide es `.connsearch-hit.is-highlighted`, que mezcla el
      acento al 16 % sobre la superficie y no es ninguna de las tres medidas
- [x] 4.2 Retirado el CSS sin uso comprobado con grep: `.connbar-row`,
      `.connbar-active(:hover)`, `.connbar-status(.lost)` y `.connbar-caret`.
      `.connbar-drop` **se queda**: ahora envuelve al buscador
- [x] 4.3 Texto nuevo por `t()` con espejo en `messages/en.ts`; retiradas
      `conn.choose`, `conn.statusConnected`, `conn.connecting` y
      `conn.disconnect` (todo desconectar va nombrado desde la fase B).
      **A comprobar en 5.4**: al quitar `conn.connecting` de la lista no queda
      señal de «conectando» en ninguna parte
- [x] 4.4 Recorrer la barra, el buscador y la pestaña con la app en inglés —
      automatizado en `connection-switcher.spec.ts` («in English»), que abre una
      conexión desde el buscador y llega a la pestaña por «Manage»

## 5. Cierre

- [x] 5.1 `pnpm test` y `pnpm typecheck` en verde en las tres fases
- [x] 5.2 Actualizar el helper `connect()` de `e2e/support/app-actions.ts` al
      gesto nuevo (`+` → escribir → elegir) y correr `pnpm e2e` **entero**: de
      ese helper cuelga toda la suite. 140 en verde contra los cinco motores.
      Además del helper hubo que mover tres specs que pasaban por el gestor
      viejo: `import-connections` (el selector de ficheros vive en la pestaña),
      `paste-rows-english` (ya no hay un «Disconnect» a secas) y `toolbar` (la
      herramienta número once y su excepción sin conexión)
- [x] 5.3 E2E propio (`e2e/connection-switcher.spec.ts`): abrir dos conexiones,
      cambiar de una a otra sin cerrar ninguna y comprobar que cada sección del
      explorador es la suya; buscar por motor, por nombre sin acentos y sin
      coincidencias; la ya abierta sale marcada y elegirla solo la enfoca. Dos
      conexiones al mismo SQLite distinguidas por nombre, con
      `seedConnections()` nuevo en `support/state.ts`
- [ ] 5.4 Probado a mano en la ventana nativa (WebView2, build x86) con tres
      conexiones abiertas de motores distintos, una de ellas Informix
- [ ] 5.5 Capturas regeneradas (`pnpm media`: `app-dark`, `app-light` e
      `initial-dark` llevan la barra) y el manual al día («Varias conexiones a la
      vez», «Crear una conexión», «Llevártelas a otro equipo»)
- [x] 5.6 Resueltas en `design.md`: el grupo **no** va en la fila (es criterio de
      búsqueda, no de reconocimiento); el atajo del buscador queda **aplazado** a
      un issue propio, porque comprobar que `Mod+Shift+O` está libre exige la
      ventana nativa (5.4)
- [x] 5.8 **Defecto de accesibilidad que encontró el e2e**: el emoji del icono
      de conexión entraba en el nombre accesible de la fila del gestor
      («🗄️ Nómina SQLite · …»), justo lo que la mudanza a SVG (#332) había
      zanjado en el resto de la interfaz. Marcado como decorativo
- [ ] 5.9 **Pendiente, fuera de alcance**: en el gestor, que una conexión esté
      abierta lo dice **solo** un `●` con `title`, que un lector de pantalla lee
      como el carácter. El buscador sí lo dice con palabras («Abierta»). Darle
      texto es un cambio de interfaz que merece su propio issue; no se toca aquí
      para no colar un rediseño en una entrega de pruebas
- [ ] 5.7 Commits en Conventional Commits referenciando el issue del cambio
