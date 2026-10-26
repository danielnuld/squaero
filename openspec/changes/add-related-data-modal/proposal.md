## Why

Para saber si un registro tiene datos dependientes hay que escribir a mano un
`SELECT` por cada tabla hija, copiando los valores de la llave columna por
columna. En esquemas con llaves compuestas de cuatro o cinco columnas (ERP sobre
Informix, el caso que motiva la petición) eso son varios minutos y varias
consultas para responder algo que el catálogo ya sabe. Los usuarios lo piden
explícitamente como lo hace Server Studio: un modal de *datos relacionados* que
parte del renglón seleccionado.

## What Changes

- Desde una celda de una **columna referenciada** por otras tablas (marcada en la
  rejilla), una acción **«Datos relacionados»** abre un modal anclado a esa
  columna y su valor (`pedidos.consec = 1`) que lista las tablas dependientes,
  cada una con el filtro concreto que le corresponde
  (`pedido_producto where ciudad=3 and anio_ped=2024 …`, la llave completa).
- El modal es maestro-detalle: las tablas dependientes en una columna angosta a
  la izquierda —cada una con **cuántas filas** dependen de ese renglón, que es la
  respuesta que se vino a buscar— y el resultado ocupando todo lo demás, con el
  SQL generado debajo para copiarlo.
- El resultado se puede abrir en una pestaña propia o mandar al editor; también
  se navega entre relaciones sin cerrar el modal.
- La lectura de llaves foráneas gana la **dirección inversa** (qué tablas
  referencian a esta) y **agrupación por restricción**, para que una llave
  compuesta viaje completa en vez de como pares de columnas sueltos.
- Informix resuelve las llaves **multi-columna** (`part1..part16`) en vez de solo
  la primera columna del índice, que es la limitación que hoy haría inservible la
  función justo en el motor donde se pidió.
- Motores sin metadatos de llave foránea (MongoDB) declaran honestamente que no
  la soportan: el modal explica por qué, no inventa relaciones por nombre.

## Capabilities

### New Capabilities

- `foreign-key-metadata`: leer del catálogo de cada motor las relaciones de llave
  foránea reales — salientes y entrantes, agrupadas por restricción y con todas
  sus columnas — o declarar que el motor no las expone.
- `related-data`: a partir de un renglón concreto, enumerar sus relaciones
  entrantes, construir la consulta filtrada de cada una y presentarlas en un
  modal navegable con acciones para continuar el trabajo.

### Modified Capabilities

Ninguna: `openspec/specs/` está vacío porque OpenSpec se inicializó con este
cambio. El comportamiento de llaves foráneas que ya existe en el código queda
descrito por primera vez en `foreign-key-metadata`.

## Impact

- **Frontend, sobre todo.** `utils/foreignKeys.ts` (dirección y agrupación),
  `utils/fkLookup.ts` (comparte el descubrimiento de llaves), un módulo puro
  nuevo para armar el filtro y el SQL de cada relación, un componente de modal
  nuevo, y el menú contextual de la rejilla como punto de entrada.
- **Sin cambios en el core ni en el ABI de drivers**: todo se resuelve con
  `query.run` sobre los catálogos, como ya lo hacen el diagrama ER y el navegador
  de llaves foráneas.
- **Riesgo acotado a Informix**: pasar de `part1` a `part1..part16` toca una
  consulta de catálogo que hoy usan el diagrama ER y el navegador de llaves; hay
  que verificarla contra un servidor real, no solo en pruebas.
- Issue relacionado: #310.
