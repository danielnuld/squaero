## Context

Quaero ya lee llaves foráneas reales del catálogo: `utils/foreignKeys.ts` arma la
consulta por motor y `parseForeignKeys` la interpreta a una forma común. De ahí
comen el diagrama ER (todas las llaves de la base) y el navegador de valores al
editar (`utils/fkLookup.ts`, `components/FkBrowser.tsx`), que resuelve la
dirección **saliente**: estando en `pedidos.cliente_id`, mostrar los `clientes`.

Este cambio necesita la dirección contraria y a partir de un renglón concreto.
Dos límites del código actual estorban:

1. `ForeignKey` es un par suelto `(fromTable, fromColumn, toTable, toColumn)` sin
   identidad de restricción, así que una llave compuesta llega como N pares que
   no se pueden reagrupar con certeza. El filtro del modal necesita exactamente
   esa agrupación.
2. La consulta de Informix resuelve solo `part1` de `sysindexes` — limitación
   documentada a propósito, tolerable para dibujar una arista del diagrama ER,
   inservible para construir un `WHERE` de cinco columnas. Y es justo el motor del
   esquema que motivó la petición.

Todo se resuelve con `query.run` sobre catálogos, como lo existente: el core y el
ABI de drivers no se tocan.

## Goals / Non-Goals

**Goals:**

- Responder «¿este registro tiene dependientes?» sin escribir SQL.
- Que funcione con llaves compuestas, que es el caso real del usuario.
- Reusar el descubrimiento de llaves que ya existe, en vez de un segundo camino
  paralelo para lo mismo.
- Mantener la honestidad por motor: MongoDB no tiene llaves foráneas y lo dice.

**Non-Goals:**

- No es un explorador recursivo: se muestra un nivel de dependientes, no el árbol
  completo ni un borrado en cascada simulado.
- No cuenta más allá de un `COUNT(*)` por relación al abrir: sin recuentos
  recursivos ni agregados por columna.
- No se editan los datos relacionados desde el modal en esta entrega; para eso
  está «abrir en una pestaña», que ya trae la edición con su llave primaria.
- No se infieren relaciones por nombre de columna.

## Decisions

### Dar identidad de restricción a `ForeignKey`

Se agrega un campo de restricción (nombre en MySQL/PostgreSQL/Informix, id del
`PRAGMA` en SQLite) y una posición ordinal al par de columnas. Agrupar por
`(fromTable, constraint)` reconstruye la llave compuesta completa.

*Alternativa descartada:* agrupar heurísticamente por `(fromTable, toTable)`.
Falla cuando una tabla referencia dos veces a la misma tabla destino, que en el
esquema del usuario ocurre.

Las consultas de MySQL y PostgreSQL ya ordenan por restricción; solo hay que
proyectar la columna que ya está en el `ORDER BY`.

### Un parámetro de dirección, no una segunda consulta

`foreignKeysFor(engine, db, table)` acota hoy por tabla que referencia. Se cambia
ese último parámetro por un alcance con dirección: acotar por tabla de origen
(salientes, lo de hoy) o por tabla referenciada (entrantes, lo nuevo). Es un
`WHERE` distinto sobre la misma consulta por motor.

*Alternativa descartada:* traer todas las llaves de la base y filtrar en el
cliente. Es lo que ya se sabe que se rompe: `query.run` corta las filas en
silencio y un esquema grande pierde justo la relación que se buscaba.

SQLite no puede acotar por tabla referenciada (`PRAGMA foreign_key_list` responde
por tabla hija), así que ahí se conserva el recorrido por tabla que el diagrama ER
ya hace, filtrando al final. Queda encapsulado en la misma función para que el
llamador no distinga motores.

### Informix: `part1..part16` sin explotar la consulta

La consulta actual junta `sysindexes` con `syscolumns` una vez por `part1`. Para
16 posiciones se hace un `UNION ALL` de las 16 (o el equivalente desnormalizado),
proyectando la posición como ordinal y descartando las que valen 0. Es feo y
largo, pero es SQL generado, no escrito a mano, y evita 16 viajes al servidor.
Se verifica contra el Informix real del usuario, no solo en pruebas unitarias.

*Nota:* `utils/indexes.ts` arrastra la misma limitación de `part1`. Queda fuera de
este cambio, pero la parte generadora se escribe reutilizable para poder
arreglarlo después sin repetir el truco.

### Construir el filtro en un módulo puro

Un módulo nuevo toma la relación agrupada, las columnas y valores del renglón, y
devuelve el `WHERE` y el `SELECT` de esa relación. Ahí viven las tres decisiones
delicadas: `IS NULL` en vez de `= NULL`, citado de identificadores por motor
(`quoteIdentifier` ya existe) y literales de valores según el tipo de la columna
(numérico sin comillas, texto con comillas escapadas).

*Sobre los literales:* la edición de filas no los necesitaba porque el core arma
el DML con `setTypes`. Aquí sí, porque el resultado es una consulta normal que el
usuario puede ver, copiar y mandar al editor. La clasificación de tipo ya existe
en el frontend (`classifyType`), así que la decisión de comillas se apoya en ella
y no en adivinar por el valor.

### El modal reusa la rejilla y el paginado que ya hay

El resultado se muestra con `ResultGrid` y el `SELECT` se genera con el mismo
`objectPreviewQuery` que usa la vista previa de tablas, para heredar el límite por
motor (`LIMIT`/`SKIP FIRST`) sin escribir un tercer generador de paginado.

## Risks / Trade-offs

- **La consulta de Informix con 16 posiciones puede pesar** → se acota por tabla
  (entrante o saliente) y por `tabid > 99`, como hoy; se mide contra el servidor
  real antes de cerrar.
- **Cambiar la forma de `ForeignKey` toca al diagrama ER y al navegador de FK** →
  el campo nuevo es aditivo y los consumidores actuales siguen leyendo los mismos
  pares; hay pruebas de ambos que deben seguir verdes sin tocarlas.
- **El filtro depende de que el renglón proyecte las columnas de la llave** → si
  falta una, la relación se muestra deshabilitada diciendo cuál falta, en vez de
  ejecutar un filtro incompleto que daría dependientes de más.
- **Un catálogo truncado haría creer que no hay dependientes** → se propaga la
  bandera de truncado que `query.run` ya expone y el modal lo advierte.
- **Renglones con muchos dependientes** → el modal pagina como cualquier vista
  previa; no promete traer todo.

## Migration Plan

No hay migración de datos ni de protocolo: el cambio es aditivo y vive en el
frontend. Se entrega en un PR y se verifica en la app x86 contra Informix (ERP) y
contra el MySQL de pruebas antes de mergear.

## Open Questions

- ¿La acción vive solo en el menú contextual de la rejilla, o también en el panel
  de detalle del renglón (`RowDetail`)? Se implementa primero en el menú
  contextual, que es el gesto de la herramienta de referencia.
- Resuelta: el conteo por relación va **al abrir** el modal, un `COUNT(*)` por
  relación con el mismo filtro. Es la respuesta que se vino a buscar, y sin él hay
  que recorrer relación por relación. Se lanza sin bloquear la apertura, así que
  un motor lento no deja el modal en blanco. Pendiente de medir: cuántas
  relaciones entrantes tiene la tabla más conectada de ERP.
