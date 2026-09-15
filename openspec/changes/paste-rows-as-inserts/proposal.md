## Why

Crear filas parecidas a las que ya existen es de las tareas más repetidas en un
cliente de bases de datos: un cliente de prueba igual a otro, una tarifa copiada
de la del año pasado, un registro de otra base. En Aroo hoy no hay un camino
directo:

1. **Pegar abre un asistente.** Pegar texto con tabuladores sobre una tabla
   abre el asistente de importación (#383). Para dos filas eso es vista previa,
   mapeo y transacción, cuando lo que se quiere es verlas en la rejilla, retocar
   un campo y guardar.
2. **Copiar pierde información.** `rowToTsv` escribe NULL como cadena vacía y no
   escapa tabuladores ni saltos de línea, así que lo que se pega no es lo que
   se copió.
3. **Duplicar no existe.** Hay que copiar como INSERT, abrir una consola, editar
   el SQL y ejecutarlo.
4. **Marcar filas solo sirve desde el menú contextual**, y solo con dos o más
   filas marcadas. No hay atajos de teclado para copiar ni pegar.

Además, al leer `applyEdit` apareció un fallo que este cambio agrava. Si una
operación falla a mitad, la transacción queda abierta con las anteriores ya
ejecutadas, y reintentar vuelve a ejecutar el plan entero. Con inserciones, eso
las duplica dentro de la transacción.

## What Changes

- **Copiar filas guarda también una copia exacta en memoria** (columnas, valores
  con NULL y tabla de origen), además del texto con tabuladores que siguen
  recibiendo otras aplicaciones. `Ctrl+C` sobre la rejilla copia las filas
  marcadas o, si no hay, la fila de la celda seleccionada.
- **Pegar filas sobre una tabla editable las añade como filas nuevas sin
  guardar**, en la misma sesión de edición que ya existe, que se abre sola si
  no estaba abierta. Nada se escribe en la base hasta Guardar.
  - Filas copiadas en Aroo: se colocan **por nombre de columna**, conservando
    NULL. Sirve entre tablas distintas con columnas del mismo nombre.
  - Texto de fuera con **el mismo número de columnas** que la rejilla y sin
    cabecera: se coloca por posición, con la opción «celdas vacías como NULL».
  - Todo lo demás (cabecera que no coincide, otro número de columnas o más de
    500 filas) sigue abriendo **el asistente de importación**, como hoy.
- **Clave primaria: generar o conservar.** «Generar» deja fuera las columnas de
  la clave para que la base asigne el valor. Es el valor por defecto al pegar en
  la misma tabla de origen; «conservar» lo es al pegar en otra tabla. Se cambia
  con un clic en la barra de filas pendientes.
- **Duplicar filas** (menú contextual, barra y `Ctrl+D`) equivale a copiar y
  pegar en la misma tabla.
- **Barra flotante de selección** en cuanto hay una fila marcada: copiar, copiar
  como INSERT, duplicar, pegar N filas y desmarcar. El menú contextual ofrece lo
  mismo también con una sola fila.
- **Barra de filas pendientes**: cuántas hay, el selector de clave, Descartar y
  «Revisar y guardar» (`Ctrl+S`, #436), que abre la vista previa del SQL que ya
  existe. Cada fila pendiente se puede editar y se puede quitar con su ✕.
- **Conflictos avisados antes de guardar**, cuando se pueden saber: una clave
  primaria conservada que ya existe en las filas cargadas o en otra pendiente, y
  los índices únicos del catálogo, que se leen en segundo plano como las llaves
  foráneas. Una celda en conflicto se marca y bloquea Guardar hasta corregirla o
  quitar la fila. Lo que no se puede saber de antemano lo dice la base al guardar,
  y la fila que falló queda señalada.
- **Guardar tras un fallo empieza limpio**: un fallo al aplicar deshace la
  transacción y abre otra antes de devolver el control. Las filas pendientes se
  conservan, y reintentar no duplica lo ya ejecutado.

## Capabilities

### New Capabilities

- `row-paste`: copiar filas de la rejilla con sus valores exactos y convertirlas
  en filas nuevas pendientes de guardar, en la misma tabla o en otra, con la
  clave primaria y los conflictos resueltos antes de escribir.

### Modified Capabilities

Ninguna: no hay specs previas de la rejilla ni de la edición en
`openspec/specs/`. El pegado hacia el asistente (#383) se conserva para los casos
que este cambio no cubre.

## Impact

- **Solo frontend.**
  - Módulo puro nuevo `utils/rowPaste.ts`: decidir si el pegado va a filas o al asistente, colocar las columnas, clave primaria y conflictos.
  - `utils/rowCopy.ts`: copia exacta.
  - `utils/editSession.ts`: añadir varias inserciones de una vez y quitar las columnas de la clave.
  - `App.tsx`: portapapeles de filas, `onPaste`, atajos, barras, `applyEdit` con reversión y lectura de índices únicos.
  - `components/ResultGrid.tsx`: columna del número de fila en las pendientes y celdas en conflicto.
  - Componentes nuevos `components/RowActionBar.tsx` (filas marcadas) y
    `components/PendingRowsBar.tsx` (filas pendientes).
  - `styles.css` y los dos catálogos de mensajes.
- **Sin cambios de IPC ni del core**: se usan `tx.begin`, `tx.rollback`,
  `tx.commit` y `row.insert` tal como están, más la consulta de índices de
  `utils/indexes.ts`.
- **Cambia qué hace pegar** en los casos que ahora van a filas. El asistente sigue
  a un clic desde la barra («Importar con el asistente…») por si alguien lo
  prefería.
- **Pruebas afectadas:** las de `editSession`, `rowCopy`, `importers`,
  `ResultGrid` y el e2e de pegado de #383, que hay que repartir entre los dos
  caminos.
- Fuera de alcance: pegar sobre celdas existentes para sobrescribirlas (rangos
  rectangulares, descartado en #383), arrastrar filas entre pestañas y pegar en
  vistas o resultados de consultas sin tabla de origen.
- Issue: #517. Origen: #382 y #383.
- Relacionado: `grid-styles`, que añade la columna del número de fila con la
  casilla de marcar. Este cambio la usa, pero no depende de ella: sin ese cambio,
  marcar sigue siendo Ctrl/Shift+clic.
