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

- [ ] 2.1 `ConnectionBar` reescrito: una fila por conexión abierta con raya de
      color, monograma, nombre y destino; la enfocada marcada; `listbox`/`option`
      con `aria-selected` y flechas
- [ ] 2.2 Clic en una fila enfoca (nunca abre ni cierra); desconectar y
      reconectar por fila; aviso de sesión caída (#407) en la fila
- [ ] 2.3 Estado sin conexiones abiertas: lo dice y ofrece el buscador
- [ ] 2.4 Lista con scroll propio y altura máxima por encima de cinco filas, para
      no comerse el explorador
- [ ] 2.5 `App.tsx` le pasa las abiertas ya resueltas y los cuatro callbacks; la
      cabecera de sección (#444) se queda como está, sin duplicar acciones
- [ ] 2.6 Pruebas de componente: tres abiertas con la enfocada marcada, enfocar
      no cierra, desconectar la enfocada pasa el foco a otra, fila sin color, y
      la fila caída ofrece reconectar

## 3. Buscador y pestaña del gestor (fase C)

- [ ] 3.1 Desplegable del `+`: `role="dialog"`, campo enfocado al abrir, filtra
      con `searchGroups`, marca las abiertas, ↑/↓ + Enter, Escape y clic fuera
      cierran
- [ ] 3.2 Elegir una cerrada la abre y la enfoca; una ya abierta solo la enfoca;
      sin coincidencias lo dice
- [ ] 3.3 Pie del desplegable: nueva conexión, importar y gestionar
- [ ] 3.4 `ToolKind` += `connections`, en `GLOBAL_TOOLS` y en `TOOL_CATALOG`;
      `ConnectionManager` pasa a ser el contenido de la pestaña, sin conectar
- [ ] 3.5 Retirar `connbarOpenTick` y su efecto; comprobar que guardar una
      conexión nueva la deja visible en el gestor y en el buscador
- [ ] 3.6 Pruebas: buscar por motor y por servidor, elegir abierta vs cerrada,
      una sola pestaña de gestor con dos conexiones distintas enfocadas,
      exportar con contraseñas conserva el aviso, importar de DBeaver sigue
      leyendo los dos ficheros

## 4. Estilos, temas e idioma

- [ ] 4.1 CSS con los tokens de las escalas y sin transiciones; revisado en
      oscuro, claro, Ciruela, Pizarra y Terminal, con la guardia de contraste en
      verde
- [ ] 4.2 Retirar el CSS que quede sin uso (`.connbar-active`, `.connbar-drop`,
      `.connbar-status`…) comprobando con grep que nadie más lo usa
- [ ] 4.3 Texto nuevo por `t()` con espejo en `messages/en.ts`; retirar las
      claves `conn.*` que queden sin uso (`conn.choose`, `conn.statusConnected`…)
- [ ] 4.4 Recorrer la barra, el buscador y la pestaña con la app en inglés

## 5. Cierre

- [ ] 5.1 `pnpm test` y `pnpm typecheck` en verde en las tres fases
- [ ] 5.2 Actualizar el helper `connect()` de `e2e/support/app-actions.ts` al
      gesto nuevo (`+` → escribir → elegir) y correr `pnpm e2e` **entero**: de
      ese helper cuelga toda la suite
- [ ] 5.3 E2E propio: abrir dos conexiones, cambiar de una a otra y comprobar que
      cada sección del explorador es la suya; buscar por motor y abrir desde el
      buscador
- [ ] 5.4 Probado a mano en la ventana nativa (WebView2, build x86) con tres
      conexiones abiertas de motores distintos, una de ellas Informix
- [ ] 5.5 Capturas regeneradas (`pnpm media`: `app-dark`, `app-light` e
      `initial-dark` llevan la barra) y el manual al día («Varias conexiones a la
      vez», «Crear una conexión», «Llevártelas a otro equipo»)
- [ ] 5.6 Resolver las preguntas abiertas del diseño (grupo en la fila, atajo del
      buscador) antes de cerrar
- [ ] 5.7 Commits en Conventional Commits referenciando el issue del cambio
