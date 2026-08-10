## Why

Todo lo que se prueba hoy se prueba **por piezas**: `ctest` cubre el núcleo y los
helpers puros de cada driver, `vitest` cubre los utils del frontend, y
`scripts/smoke/smoke.mjs` recorre el camino crítico del núcleo **sin interfaz**.
Nadie comprueba nunca que la interfaz y el núcleo funcionen **juntos** contra una
base de datos real.

Ese hueco es exactamente donde han vivido los últimos bugs, y no son bugs de
lógica pura: la grilla colgada para siempre de #315 era un byte inválido cruzando
el puente; el `LIKE '%ñada%'` que devolvía cero filas de #324 sólo se ve
ejecutando una consulta de verdad contra un motor de verdad. Ninguna prueba
unitaria podía haberlos visto, y los encontramos a mano las dos veces.

Con los contenedores de Postgres, MySQL e Informix ya en marcha para el trabajo de
encoding, el coste de cerrar el hueco es montar el arnés una vez.

## What Changes

- **Módulo E2E nuevo con Playwright** en `frontend/e2e/`, ejecutable con
  `pnpm e2e`. Playwright es `devDependency` del paquete frontend; **no toca el
  binario** ni el build x86.
- **Sin nada simulado.** El frontend habla con el núcleo por un único global,
  `globalThis.quaeroRpc`, así que el arnés lo inyecta apuntando a un proceso
  `quaero-rpc` **real**. Cada prueba ejercita frontend real → núcleo C real →
  driver real → base de datos real.
- **Matriz de motores** sobre los contenedores existentes: SQLite (sin
  contenedor), PostgreSQL, MySQL e Informix. Cada motor **se salta solo** cuando su
  base no responde o su driver no cargó, así que la suite es útil en una máquina
  sin todos los motores y en CI.
- **Siembra determinista** por motor a través del propio núcleo antes de abrir el
  navegador, no por la interfaz: rápida y no depende de que la UI funcione.
  Reutiliza las filas de `enc_test` que ya distinguen un arreglo de encoding real
  de uno aparente.
- **Fase 1 completa el camino crítico** por motor —conectar, árbol, describe,
  SELECT paginado, edición transaccional con rollback, export, desconectar— más el
  caso acentuado, y deja un patrón documentado para añadir el resto.
- **Las fases siguientes quedan enumeradas** por área en `tasks.md`, para
  priorizarlas sin volver a inventariar los 44 componentes.

## Capabilities

### New Capabilities

- `e2e-harness`: cómo una prueba obtiene un Quaero funcionando contra una base de
  datos real — el puente al núcleo, la matriz de motores, la siembra, y qué pasa
  cuando un motor no está disponible.
- `e2e-critical-path`: el recorrido que debe funcionar en todo motor soportado,
  extremo a extremo por la interfaz, incluido el texto acentuado.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío.

## Impact

- **Sólo añade.** `frontend/e2e/` (nuevo), `frontend/package.json`
  (script + devDependency), `playwright.config.ts`. Ninguna línea de producción
  cambia: el arnés usa la costura que ya existe.
- **Establece la convención de E2E**, que `.rules/testing.md` todavía no tiene.
  Ese fichero se amplía con la sección y con cómo correr la suite.
- **Selectores**: no hay ni un `data-testid` en el frontend, pero sí 42
  `aria-label` y roles correctos (`dialog`, `tab`, `radiogroup`, `alert`). Las
  pruebas usan localizadores por rol y etiqueta, que además comprueban la
  accesibilidad. Donde falte la etiqueta, **añadirla es preferible a inventar un
  testid**; cada caso así se anota en lugar de resolverlo en silencio.
- **Idioma fijado**: `es` es el catálogo base y el idioma se autodetecta, así que
  el arnés fija `quaero.locale` antes de cargar. Sin eso, las aserciones por texto
  dependerían del idioma de la máquina.
- **Fuera de alcance, con su fase propia**: la shell nativa WebView2 —ventana,
  menús, diálogos de fichero, persistencia de `localStorage` por origen, modal de
  actualización, enlaces externos— no se puede conducir desde un navegador. Se
  propone después un smoke mínimo contra el ejecutable real por CDP.
- **MongoDB** no tiene contenedor todavía; entra cuando lo tenga.
- **Informix exige el build x86**, porque el ODBC de IBM es de 32 bits. El arnés
  elige el binario de `quaero-rpc` por variable de entorno.
