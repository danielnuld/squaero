## Why

Tres defectos reportados desde el uso real, los tres con la misma forma: un
estado que sobrevive más de lo que debería.

- **#313** — la posición de scroll de la rejilla sobrevive a la destrucción del
  scroller. Tras un error de sintaxis, la siguiente consulta buena renderiza sus
  filas fuera de la vista y la rejilla se ve vacía.
- **#314** — el refresco después de editar un renglón toma el texto **actual** del
  editor en vez de la consulta que llenó la rejilla. Si el usuario cambió el
  editor entre correr y editar, se ejecuta algo que nunca pidió. Es el más grave
  de los tres: es una ejecución no solicitada, no una molestia visual.
- **#315** — en Informix las vistas caen en la carpeta «Tablas». El `CASE` del
  catálogo devuelve `CHAR(5)` y la rama corta llega rellenada: `'view '` nunca
  iguala a `'view'`.

## What Changes

- La rejilla **reinicia su posición de scroll** al recibir un resultado nuevo y
  al montarse el scroller, de modo que la ventana virtualizada y el DOM nunca
  discrepan (#313).
- El refresco de un resultado re-ejecuta **la consulta que lo produjo**
  (`pageSql`) en su misma página (`offset`), nunca el contenido del editor. Sin
  consulta guardada no se ejecuta nada (#314).
- El refresco actúa sobre la **pestaña indicada**, no sobre la enfocada, como ya
  hace el camino de vista previa de tabla (#314, defecto secundario).
- Las consultas de catálogo de Informix devuelven el tipo de objeto **sin
  relleno**, y la clasificación en el frontend **normaliza** el valor recibido
  (#315).

## Capabilities

### New Capabilities

- `result-view`: cómo una pestaña presenta y refresca el resultado de una
  consulta — qué SQL se re-ejecuta, sobre qué pestaña, y en qué estado queda la
  rejilla al cambiar el resultado.
- `object-type-classification`: cómo se decide si un objeto del catálogo es tabla
  o vista, con el contrato del valor (`table`/`view`) que los drivers entregan y
  el frontend interpreta.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío. Estas dos capacidades describen por
primera vez comportamiento que ya existe en el código, con los defectos
corregidos.

## Impact

- **Solo frontend, salvo una consulta de driver.** `components/ResultGrid.tsx`
  (scroll), `App.tsx` (`reloadCurrent` + `run` con `tabId`),
  `utils/schema.ts` y `utils/objectList.ts` (normalización y SQL de Informix).
- **Un cambio en C**: el `SELECT` de `ifx_list_tables`
  (`drivers/informix/src/metadata.c`). Sin cambios de ABI ni de contrato IPC.
- **Riesgo**: `reloadCurrent` lo llaman aplicar, descartar, el refresco manual y
  los asistentes de generación/importación; los cuatro cambian de fuente de SQL.
  Es el punto a cubrir con pruebas.
- **Verificación contra Informix real** para #315: la hipótesis del relleno
  `CHAR` viene del catálogo, no de una prueba; se confirma en el servidor.
- Issues: #313, #314, #315.
