## ADDED Requirements

### Requirement: Copiar filas conserva los valores exactos
Copiar filas de la rejilla SHALL escribir en el portapapeles el texto separado
por tabuladores, como hoy, y MUST guardar además en memoria una copia exacta con
los nombres de columna, los valores (NULL distinto de cadena vacía, y tabuladores
y saltos de línea intactos), la tabla de origen y la conexión. `Ctrl+C` con la
rejilla enfocada MUST copiar las filas marcadas o, si no hay ninguna, la fila de
la celda seleccionada. Copiar como INSERT MUST NOT sustituir la copia exacta.

#### Scenario: NULL sobrevive a copiar y pegar
- **WHEN** el usuario copia una fila con `saldo` NULL y `ciudad` vacía y la pega en la misma tabla
- **THEN** la fila pendiente tiene `saldo` NULL y `ciudad` como cadena vacía

#### Scenario: Ctrl+C sin marcas
- **WHEN** no hay filas marcadas, la celda seleccionada está en la fila 4 y el usuario pulsa Ctrl+C
- **THEN** se copia la fila 4

### Requirement: Pegar filas de Aroo las añade como filas nuevas pendientes
Pegar sobre la rejilla de una tabla editable, cuando el texto del portapapeles
coincide con la última copia exacta, SHALL añadir una fila pendiente por cada
fila copiada, colocando los valores por nombre de columna sin distinguir
mayúsculas. Si no había una sesión de edición abierta, pegar MUST abrirla primero.
Las columnas copiadas que la tabla destino no tiene MUST ignorarse y avisarse;
las columnas de la tabla destino que no venían en la copia MUST quedar fuera de
la inserción, para que la base aplique su valor por defecto. Pegar MUST NOT
escribir nada en la base.

#### Scenario: Pegar en la misma tabla
- **WHEN** el usuario marca dos filas de `clientes`, pulsa Ctrl+C y después Ctrl+V sobre la misma rejilla
- **THEN** aparecen dos filas pendientes con los valores copiados y la barra dice «2 filas nuevas sin guardar»

#### Scenario: Pegar en otra tabla con columnas en común
- **WHEN** el usuario copia filas de `clientes` (id, nombre, email, ciudad) y las pega en `prospectos` (id, nombre, email, origen)
- **THEN** las filas pendientes llevan id, nombre y email; `origen` queda fuera de la inserción; y se avisa de que `ciudad` no existe en `prospectos`

#### Scenario: Pegar sin sesión de edición
- **WHEN** la rejilla no está en modo edición y el usuario pega filas copiadas
- **THEN** se abre la sesión de edición y las filas quedan pendientes dentro de ella

### Requirement: Pegar texto de otras aplicaciones
Si el portapapeles no coincide con la última copia exacta, pegar SHALL crear
filas pendientes solo cuando el texto tiene el mismo número de columnas que la
rejilla en todas sus líneas y como mucho 500 filas. Si la primera línea coincide
con los nombres de columna, se usa como cabecera y los valores se colocan por
nombre; si no, por posición en el orden visible de la rejilla. La barra de
pendientes MUST ofrecer «celdas vacías como NULL», activada por defecto. En
cualquier otro caso, pegar MUST abrir el asistente de importación con el texto,
como hasta ahora.

#### Scenario: Hoja de cálculo con las mismas columnas
- **WHEN** el usuario pega tres líneas con 7 valores separados por tabuladores sobre una rejilla de 7 columnas
- **THEN** aparecen tres filas pendientes colocadas por posición y las celdas vacías son NULL

#### Scenario: Forma distinta
- **WHEN** el usuario pega un CSV de 5 columnas sobre una rejilla de 7
- **THEN** se abre el asistente de importación con ese texto y no se crean filas pendientes

#### Scenario: Muchas filas
- **WHEN** el usuario pega 2 000 filas copiadas
- **THEN** se abre el asistente de importación con esas filas y no se crean filas pendientes

### Requirement: Clave primaria generada o conservada
La barra de filas pendientes SHALL ofrecer «clave: generar» y «clave: conservar».
Con «generar», las columnas de la clave primaria MUST quedar fuera de la inserción
y mostrarse como `auto`. Con «conservar», MUST insertarse el valor copiado. El
valor inicial MUST ser «generar» cuando la tabla destino es la de origen de la
copia y «conservar» en cualquier otro caso. El cambio MUST aplicarse a todas las
filas pendientes pegadas de esa vez.

#### Scenario: Generar en la misma tabla
- **WHEN** el usuario pega en `clientes` filas copiadas de `clientes`
- **THEN** la columna `id` de las filas pendientes muestra `auto` y el SQL de la vista previa no incluye `id`

#### Scenario: Clave sin valor por defecto
- **WHEN** la clave no tiene valor por defecto ni autoincremento, el usuario deja «generar» y guarda
- **THEN** la base rechaza la inserción, la fila queda señalada con el mensaje de la base y la sesión sigue abierta con las filas pendientes intactas

### Requirement: Duplicar filas
El menú contextual, la barra de selección y `Ctrl+D` SHALL duplicar las filas
marcadas (o la fila de la celda seleccionada) como filas pendientes de la misma
tabla, con «clave: generar». Duplicar MUST NOT cambiar la copia exacta del
portapapeles.

#### Scenario: Duplicar una fila
- **WHEN** el usuario pulsa «Duplicar fila» en el menú contextual de la fila 3
- **THEN** aparece una fila pendiente con los valores de la fila 3 y la clave en `auto`

### Requirement: Barra de selección
Con al menos una fila marcada y sin filas pendientes, la rejilla SHALL mostrar una
barra flotante con el número de filas marcadas, Copiar, Copiar como INSERT,
Duplicar, Pegar (desactivado si no hay nada que pegar, e indicando cuántas filas)
y Desmarcar. Escape MUST desmarcar. Las entradas equivalentes del menú contextual
MUST aparecer también con una sola fila marcada.

#### Scenario: Una fila marcada
- **WHEN** el usuario marca una sola fila
- **THEN** aparece la barra con «1 fila marcada» y el menú contextual ofrece «Copiar fila» y «Duplicar fila»

### Requirement: Barra de filas pendientes
Con filas pendientes, la rejilla SHALL mostrar una barra con el número de filas
nuevas, los conflictos conocidos, el selector de clave, Descartar y «Revisar y
guardar». Guardar ya pasa siempre por la vista previa del SQL, así que no hay un
«Ver SQL» aparte: «Revisar y guardar» y `Ctrl+S` MUST abrir esa vista previa antes
de ejecutar nada. Cada fila pendiente MUST llevar un botón ✕ que la quita y MUST
poderse editar celda a celda.

#### Scenario: Quitar una fila pendiente
- **WHEN** hay tres filas pendientes y el usuario pulsa la ✕ de la segunda
- **THEN** quedan dos filas pendientes y la barra dice «2 filas nuevas sin guardar»

#### Scenario: Descartar
- **WHEN** el usuario pulsa Descartar
- **THEN** desaparecen las filas pendientes y la transacción se deshace

### Requirement: Conflictos avisados antes de guardar
Antes de guardar, la rejilla SHALL marcar como conflicto la celda de una fila
pendiente cuando: (a) con «clave: conservar», el valor de la clave coincide con
el de una fila cargada o con el de otra pendiente; o (b) una columna con índice
único, según el catálogo, coincide con una fila cargada o con otra pendiente. Los
índices únicos MUST leerse en segundo plano al abrir la sesión de edición, y su
ausencia (motor sin catálogo o consulta fallida) MUST NOT impedir pegar ni
guardar. Con algún conflicto, Guardar MUST quedar desactivado con el motivo en su
tooltip, y MUST reactivarse al corregir la celda o quitar la fila.

#### Scenario: Email único duplicado
- **WHEN** `email` tiene un índice único y el usuario pega en la misma tabla una fila copiada
- **THEN** la celda `email` de la fila pendiente aparece en conflicto, la barra dice «1 choca con un valor único» y Guardar está desactivado

#### Scenario: Corregir el conflicto
- **WHEN** el usuario cambia el email de esa fila pendiente por uno que no existe
- **THEN** la marca de conflicto desaparece y Guardar se activa

#### Scenario: Sin catálogo de índices
- **WHEN** la consulta de índices falla
- **THEN** pegar y guardar funcionan igual, y un duplicado solo se descubre al guardar

### Requirement: Un fallo al guardar no deja la sesión a medias
Si una operación falla al aplicar los cambios, la aplicación SHALL deshacer la
transacción y abrir otra antes de devolver el control, MUST conservar todas las
filas pendientes y ediciones, y MUST señalar la fila pendiente cuya inserción
falló junto con el mensaje de la base. Reintentar MUST ejecutar el plan completo
una sola vez sobre la transacción nueva.

#### Scenario: Reintento sin duplicados
- **WHEN** de tres inserciones pendientes, la segunda falla por un duplicado; el usuario corrige esa fila y vuelve a guardar
- **THEN** en la tabla quedan exactamente tres filas nuevas, no cuatro

#### Scenario: Fila señalada
- **WHEN** la segunda inserción falla
- **THEN** la segunda fila pendiente queda marcada y el error de la barra muestra el mensaje de la base

### Requirement: Pegar solo donde se puede escribir
Pegar como filas nuevas SHALL estar disponible solo en la rejilla de una tabla con
tabla de origen y edición permitida. En una rejilla de solo lectura (resultado de
una consulta, vista o tabla sin clave primaria), pegar MUST comportarse como hasta
ahora: abrir el asistente de importación si la rejilla tiene tabla de origen, o
no hacer nada. Pegar dentro de un campo de texto MUST NOT interceptarse.

#### Scenario: Resultado de consulta
- **WHEN** el usuario pega filas sobre el resultado de un `SELECT` con `JOIN`
- **THEN** no se crean filas pendientes

#### Scenario: Pegar dentro de una celda en edición
- **WHEN** el usuario pega texto con tabuladores dentro del campo de una celda que está editando
- **THEN** el texto se pega en ese campo y no se crean filas
