## 1. Metadatos de llave foránea: identidad y agrupación

- [x] 1.1 Agregar la identidad de restricción y el ordinal de columna a
      `ForeignKey`, proyectando la columna que MySQL y PostgreSQL ya tienen en su
      `ORDER BY` y el id del `PRAGMA` en SQLite
- [x] 1.2 Agregar `groupForeignKeys()`: de pares sueltos a relaciones agrupadas por
      `(tabla, restricción)` con sus columnas en orden
- [x] 1.3 Pruebas: llave simple, llave compuesta de cuatro columnas, dos llaves
      distintas hacia la misma tabla destino, y que el orden de columnas se
      conserve
- [x] 1.4 Verificar que el diagrama ER y el navegador de FK siguen verdes sin
      tocar sus pruebas (el campo es aditivo)

## 2. Dirección entrante

- [x] 2.1 Cambiar el parámetro `table` de `foreignKeysFor()` por un alcance con
      dirección (referencia / referenciada), manteniendo el comportamiento actual
      en la dirección saliente
- [x] 2.2 Implementar el `WHERE` entrante por motor: MySQL
      (`REFERENCED_TABLE_NAME`), PostgreSQL (`cf.relname`), Informix (`pt.tabname`)
- [x] 2.3 SQLite: recorrer las tablas conocidas y quedarse con las relaciones que
      apuntan a la tabla consultada, encapsulado para que el llamador no distinga
      motores
- [x] 2.4 Pruebas por motor del SQL generado en ambas direcciones, más el caso sin
      dependientes y el motor no soportado (MongoDB)

## 3. Informix multi-columna

- [x] 3.1 Generar la resolución de `part1..part16` para los dos lados de la
      restricción, proyectando la posición como ordinal y descartando las vacías
- [x] 3.2 Escribir la parte generadora de forma reutilizable, para poder quitar
      después la misma limitación en `utils/indexes.ts`
- [x] 3.3 Pruebas del SQL generado: una columna, cinco columnas, sin filas espurias
      por las posiciones no usadas
- [ ] 3.4 Verificar contra el Informix real (ERP): una llave compuesta conocida
      devuelve sus pares completos y emparejados

## 4. Construcción del filtro y de la consulta

- [x] 4.1 Módulo puro nuevo: de una relación agrupada + columnas y valores del
      renglón, obtener las condiciones del filtro
- [x] 4.2 Literales de valor por tipo apoyados en `classifyType` (numérico sin
      comillas, texto escapado) e identificadores con `quoteIdentifier` del motor
- [x] 4.3 `IS NULL` cuando el valor del renglón es NULL
- [x] 4.4 Devolver «no se puede filtrar» nombrando la columna faltante cuando el
      resultado no la proyecta
- [x] 4.5 Generar el `SELECT` con `objectPreviewQuery` para heredar el paginado por
      motor
- [x] 4.6 Pruebas del módulo: valores de texto con comillas, numéricos, NULL,
      columna faltante, llave compuesta

## 5. Modal de datos relacionados

- [x] 5.1 Componente del modal maestro-detalle: título anclado a
      `<tabla>.<columna> = <valor>`, columna angosta con las relaciones cuya llave
      incluye esa columna, y el resultado ocupando el resto
- [x] 5.2 Conteo por relación (`COUNT(*)` con el mismo filtro), sin bloquear la
      apertura: pendiente mientras llega, cero apagado, error como desconocido
- [x] 5.3 Ejecutar la relación elegida contra la conexión del resultado de origen y
      mostrar las filas en `ResultGrid` como contenido principal, con el SQL
      generado debajo
- [x] 5.4 Estados: sin relaciones, sin filas, error del motor sin cerrar el modal,
      relación deshabilitada por columna faltante, motor sin llaves foráneas
- [x] 5.5 Advertir cuando el catálogo llegó truncado
- [x] 5.6 Navegación entre relaciones sin cerrar el modal
- [x] 5.7 Acciones: abrir en pestaña (titulada con la tabla dependiente, ligada a
      la misma conexión) y mandar el SQL al editor

## 6. Punto de entrada e integración

- [x] 6.1 Agregar «Datos relacionados de <columna> = <valor>» al menú contextual
      de celda, solo sobre columnas referenciadas por alguna llave foránea entrante
      y con tabla de origen identificable
- [x] 6.2 Marcar en el encabezado de la rejilla las columnas referenciadas, para
      que se vea dónde está disponible la acción
- [x] 6.3 Cablear en `App.tsx`: cargar las relaciones entrantes de la tabla y abrir
      el modal anclado a la columna y el renglón elegidos
- [x] 6.4 Textos en `es` y su espejo en `en`

## 7. Cierre

- [x] 7.1 `pnpm test` verde con las pruebas nuevas
- [ ] 7.2 Compilar x86 y probar en la app real contra Informix (ERP) y contra el
      MySQL de pruebas
- [ ] 7.3 Commit y PR referenciando el issue #310
