## Context

Lo que ya existe y este cambio reutiliza:

- **Sesión de edición** (`utils/editSession.ts`). `PendingChanges = { edits,
  deletes, inserts }`, donde cada inserción es un mapa `columna → valor`.
  `buildPlan` solo inserta las columnas presentes en el mapa, así que dejar
  fuera una columna deja que la base aplique su valor por defecto.
- **Flujo de edición en `App.tsx`**:
  - `beginEdit` abre `tx.begin`.
  - `confirmEdit` genera el SQL de vista previa, operación a operación.
  - `applyEdit` ejecuta el plan en orden y hace `tx.commit`; si algo falla, deja
    la transacción abierta y muestra el error.
  - `discardEdit` hace rollback.
  - `Ctrl+S` llama a `confirmEdit` (#436).
- **Filas nuevas en la rejilla**: `ResultGrid` pinta las inserciones en una
  sección `grid-inserts` bajo las filas, con campos editables
  (`onInsertCell`, `onRemoveInsert`).
- **Marcas** (#382): `markedRows()` y `pickRows()`; el menú contextual copia
  filas, copia como INSERT y transfiere solo con más de una fila marcada.
- **Copiar**: `rowToTsv` (`utils/rowCopy.ts`) une con tabuladores y convierte
  NULL en `""`, sin escapar nada. `copyText` es la escritura al portapapeles, sin
  fallar si no está disponible.
- **Pegar** (#383): un listener `paste` en `document` lee
  `clipboardData.getData("text/plain")`. Si hay tabulador o salto de línea y la
  rejilla tiene `source`, abre el asistente con el texto. Se ignora dentro de
  `INPUT`, `TEXTAREA` y contenido editable.
- **Catálogo de índices**: `indexListFor(engine, …)` en `utils/indexes.ts`
  devuelve el SQL que lista índices con su marca de único. `loadFkLookups` es el
  patrón de «cargar en segundo plano al entrar en edición, sin bloquear si
  falla».
- **Metadatos**: no hay autoincremento en los metadatos del resultado; solo
  `source.pk`.

El plano es el artboard «Prototipo · conexiones y rejilla» del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2. Cómo probarlo está en la nota
de ese artboard, pasos 2 a 4.

## Goals / Non-Goals

**Goals:**

- Copiar y pegar filas sin perder NULL ni caracteres especiales.
- Pegar no escribe nada: todo pasa por las filas pendientes y la vista previa
  que ya existen.
- Avisar de los conflictos que se pueden saber y señalar con precisión los que
  no.
- Arreglar el reintento de `applyEdit`.

**Non-Goals:**

- Sobrescribir celdas existentes pegando un rango (descartado en #383).
- Pegar en resultados sin tabla de origen o de solo lectura.
- Detectar duplicados contra filas que no están cargadas en la página: eso lo
  dice la base al guardar.
- Sustituir el asistente de importación.

## Decisions

### 1. Portapapeles de filas en memoria, emparejado con el texto

`App.tsx` guarda la señal `rowClipboard: { text, columns: string[], rows:
(string|null)[][], source: { connDefId, db, schema, table } } | null`. Copiar
escribe `text = rowToTsv…` al portapapeles del sistema y guarda la misma cadena
en la señal. Al pegar, si `clipboardData.getData("text/plain") === rowClipboard.text`,
se usa la copia exacta; si no, el texto es de otra aplicación.

*Por qué:* el evento `paste` es la única lectura del portapapeles que el webview
garantiza (#383), y un formato propio (`application/x-aroo-rows`) no se puede
escribir con `copyText`. Comparar el texto detecta si alguien copió otra cosa
después.

*Alternativa descartada:* escapar el TSV (NULL como `\N`, tabuladores escapados).
Rompe lo que reciben otras aplicaciones y sigue siendo ambiguo para texto de
fuera.

### 2. Toda la decisión de pegado en un módulo puro

`utils/rowPaste.ts` exporta
`planPaste(input, target, options) → { kind: "inserts", rows, ignoredColumns, pkMode } | { kind: "wizard", reason }`.

- **Entrada**: `input` es la copia exacta o el texto del portapapeles.
- **Destino**: `target = { columns, pk, source, visibleOrder }`.
- **Copia exacta**: se coloca por nombre sin distinguir mayúsculas. Las columnas
  sin destino van a `ignoredColumns`.
- **Texto**: pasa por `parseClipboard`. Si todas las líneas tienen
  `columns.length` celdas y la primera coincide con los nombres, se toma como
  cabecera y se coloca por nombre; si solo coincide el número de celdas, por
  `visibleOrder`; en cualquier otro caso, `wizard`.
- **Límite**: más de `PASTE_ROW_LIMIT = 500` filas → `wizard` con motivo.
- **Clave**: `pkMode` inicial es `"generate"` si
  `input.source` es el mismo `connDefId + db + schema + table` que el destino, y
  `"keep"` en otro caso.

`App.tsx` solo traduce el resultado: abre el asistente o llama a `addInserts`.

### 3. `editSession` aprende a insertar en bloque y a generar la clave

- `addInserts(state, rows: Record<string, string|null>[], batch)` añade las filas
  con un identificador de lote.
- `PendingChanges` gana `pkModes: Record<batchId, "generate" | "keep">`.
- `buildPlan` quita las columnas de `source.pk` de las inserciones cuyo lote está
  en `"generate"`.

El estado de la clave vive en los datos pendientes, no en la barra, así que la
vista previa del SQL y la aplicación ven exactamente lo mismo. `setInsertCell` y
`removeInsert` no cambian.

*Alternativa descartada:* borrar la clave de los mapas al pegar. Entonces volver a
«conservar» ya no tendría los valores copiados.

### 4. Pegar abre la edición si hace falta

Con destino editable y `planPaste` en `inserts`, `onPaste` hace
`await beginEdit()` si `!currentEdit().editing` y después `mutatePending`. Un
destino que no es editable (`!currentEditable()`) sigue el camino actual: el
asistente si hay `source`, o nada. El listener sigue ignorando la escritura
dentro de campos, así que pegar en una celda en edición no se intercepta.

### 5. Conflictos: pura la detección, en segundo plano los índices

`findConflicts(pending, rows, columns, pk, uniqueSets) → Map<insertIndex, string[]>`,
donde `uniqueSets` es la lista de columnas de cada índice único. Compara contra
las filas cargadas y contra las demás pendientes. Un índice compuesto solo choca
si coinciden todas sus columnas, y NULL nunca choca, como en SQL.

`loadUniqueIndexes(tabId, conn)` sigue el patrón de `loadFkLookups`: se lanza al
entrar en edición, guarda el resultado por pestaña y cualquier fallo deja
`uniqueSets = []`.

`ResultGrid` recibe `conflicts` y marca las celdas; `RowActionBar` desactiva
Guardar con el motivo.

*Por qué no bloquear sin catálogo:* sería prometer una comprobación que no se hizo.
Sin índices, la base es la que avisa, y la decisión 6 se encarga de que ese aviso
sea útil.

### 6. `applyEdit` deshace y reabre tras un fallo

Al capturar el error, `applyEdit` guarda qué operación falló (índice en el plan →
fila pendiente), llama a `txRollback` y después a `txBegin`, y deja
`pending` intacto. Si `txBegin` también falla, la sesión sale del modo edición
con el mensaje, sin perder el SQL pendiente. `ResultGrid` recibe
`failedInsert?: number` para señalar la fila.

Esto cambia el comportamiento de las ediciones y borrados además de las
inserciones, y es a propósito. El comportamiento actual («dejar la transacción
abierta para corregir y reintentar») reintenta sobre una transacción donde
parte del plan ya se ejecutó.

### 7. Barras en un componente, atajos en el componente de la rejilla

Son dos componentes presentacionales que comparten estilo:
`components/RowActionBar.tsx` para las filas marcadas y
`components/PendingRowsBar.tsx` para las pendientes. Esta última recibe los
contadores, los conflictos, `pkMode`, «vacías como NULL», las columnas ignoradas y
los callbacks. Ninguna rama del JSX depende de un «modo», y cada una se prueba por
separado. Las dos se montan sobre la rejilla, en posición absoluta, para no robar
altura.

La barra de pendientes no tiene «Ver SQL»: guardar ya abre siempre la vista previa
del SQL, así que habría dos botones para la misma acción. Queda un solo «Revisar
y guardar». Cada fila pendiente conserva la ✕ que ya tenía para quitarla, en lugar
del `+` del prototipo, que se leía al revés.

`Ctrl+C` y `Ctrl+D` se manejan en el `onKeyDown` de `ResultGrid`, que ya maneja
`Ctrl+A`. `Ctrl+V` sigue en el listener `paste` de `document`, porque es el que
trae los datos. Escape desmarca solo si no hay una celda en edición.

## Risks / Trade-offs

- **[Riesgo] Cambiar qué hace pegar sorprende a quien usaba el asistente para
  dos filas** → El asistente sigue para cualquier forma que no encaje, y la barra
  de pendientes ofrece «Importar con el asistente…» con las mismas filas.
- **[Riesgo] «Generar» en una clave sin autoincremento** → La base lo rechaza, la
  fila se señala, la transacción se reabre limpia y basta con un clic en
  «conservar».
- **[Riesgo] El texto del portapapeles coincide por casualidad con una copia
  anterior** → Solo pasa si alguien copia en otra aplicación exactamente el mismo
  texto; el resultado sería colocar por nombre en vez de por posición, con los
  mismos valores.
- **[Riesgo] Revertir y reabrir tras un fallo cambia el comportamiento de las
  ediciones actuales** → Documentado. Cubierto con una prueba e2e contra MySQL
  real que falla en la segunda operación y reintenta.
- **[Trade-off] Conflictos solo contra la página cargada** → Una fila con el mismo
  email en la página 40 no se avisa antes; lo dice la base al guardar.
- **[Riesgo] 500 filas pendientes en `grid-inserts` sin virtualizar** → El límite
  existe por eso; por encima va el asistente, que sí está hecho para volumen.

## Migration Plan

Sin datos que migrar. Se entrega en tres PRs (ver tasks.md). La fase A incluye el
arreglo de `applyEdit`, que tiene valor por sí solo. Para revertir basta con
revertir los PRs; pegar vuelve a abrir siempre el asistente.

## Open Questions

- ¿Las filas pendientes deben seguir en la sección de abajo o intercalarse justo
  debajo de la última fila copiada? Propuesta: abajo, como hoy. Intercalar
  complica la virtualización y el orden real de inserción es el de la lista.
- ¿`Ctrl+D` está libre en WebView2? Si el host lo reclama, igual que pasó con
  `Ctrl+S` en #320, duplicar se queda solo en el menú y la barra.
