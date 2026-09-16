## Context

La rejilla es `components/ResultGrid.tsx`, una rejilla CSS virtualizada. Cada
fila y la cabecera usan `grid-template-columns` con los anchos calculados por
`computeColumnWidths`. Sus datos visuales:

- La altura de fila la da `rowHeightFor(density)` (`utils/settings.ts`: 28 o
  22 px). Llega como prop `rowHeight` para la virtualización y
  `utils/gridNav.ts` la usa para desplazar la selección a la vista.
- El texto de cada celda sale de `formatCell(value, type)` (`utils/format.ts`):
  NULL → `"NULL"`, booleanos → `0/1` y el resto tal cual. El core ya manda cada
  valor como texto.
- Los colores por tipo se apagan con `data-cell-colors="off"` en la raíz, que
  pone `App.tsx` según `settings().colorTypes`.
- Las marcas de fila (#382) son un `Set` de índices (`marks()`), que se cambian
  con Ctrl/Shift+clic y Ctrl+A. El workspace las lee con `markedRows()` para
  copiar, copiar como INSERT y transferir.
- Copiar fila y celda en `App.tsx` usa `res.rows`, que es el valor crudo, y
  exportar, INSERT y transferir también.
- La clave primaria se marca con un emoji `🔑` en `.col-key-mark`.

El plano es el artboard «Prototipo · conexiones y rejilla» del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2, con el selector «Rejilla» sobre
la tabla.

## Goals / Non-Goals

**Goals:**

- Tres estilos elegibles, con Registro como nuevo predeterminado.
- La presentación nunca altera los valores que salen de la rejilla.
- Densidad y colores por tipo siguen siendo ajustes independientes.
- Un estilo nuevo en el futuro es un valor más en la unión y un bloque de CSS.

**Non-Goals:**

- Pegar filas como filas nuevas sin guardar (cambio aparte).
- Estilo por conexión, por pestaña o definido por el usuario.
- Cambiar la rejilla de edición (inputs) más allá de la columna del número de
  fila.
- Formatear números en Registro y Hoja densa.

## Decisions

### 1. El estilo es CSS en la raíz, no una rama en el componente

`App.tsx` pone `data-grid-style="registro|hoja|informe"` en `document.documentElement`,
igual que `data-cell-colors`. Toda la diferencia visual vive en `styles.css`
bajo `:root[data-grid-style="…"] .grid-*`. `ResultGrid` pinta **la misma
estructura** en los tres estilos (columna del número de fila, cabecera con
nombre y tipo en elementos separados, NULL en su propio `span`). Lo único que
recibe según el estilo es la función que produce el texto de la celda.

*Alternativa descartada:* una prop `gridStyle` con JSX distinto por estilo. Da
tres árboles que mantener y que probar, y cualquier arreglo en uno se olvida en
los otros.

### 2. `rowHeightFor(style, density)`: una tabla, una fuente

Tabla fija `{ registro: [28, 22], hoja: [22, 20], informe: [32, 28] }`, todas
alturas de las escalas (`--h-*`, `--band-*`). `App.tsx` pasa el resultado a
`rowHeight`, y la regla CSS de `.grid-cell` ya lee `--grid-row-h`, que se fija
en línea con el mismo número. Así virtualización, navegación y CSS no pueden
desalinearse.

### 3. Formato de Informe: puro, sobre la cadena y solo para mostrar

`utils/gridDisplay.ts` exporta `displayText(value, type, style, lang)`:

- Si el estilo no es `informe` o el valor es NULL, se delega en `formatCell`
  sin cambios.
- **Números** (`classifyType === "number"`): si la cadena encaja con
  `^-?\d+(\.\d+)?$`, se agrupan los miles **en la parte entera, sobre la
  cadena**. No se pasa por `Number`, para no perder precisión en `bigint` ni
  en `decimal`, ni redondear ni quitar ceros. Si no encaja (notación
  científica, `NaN`), se muestra tal cual.
- **Fechas** (`temporal`): si la cadena empieza por `YYYY-MM-DD`, se reescribe
  la fecha como `D mmm YYYY` con los meses del catálogo de mensajes y se
  conserva el resto (la hora) intacto. Si no, tal cual, porque Informix puede
  devolver formatos según `DBDATE`.
- **Separador:** coma para miles y el punto decimal que manda el core, en
  español y en inglés. Usar el separador del locale del sistema haría que
  `1.250,00` (España) se leyera distinto de lo que se copia.

`ResultGrid` usa `displayText` para el contenido y deja `title` con el valor
crudo. `computeColumnWidths` mide con el texto mostrado, para que las comas y
los meses quepan.

*Alternativas descartadas:* `Intl.NumberFormat` (pasa por `Number` y pierde
precisión) y formatear en el core (entonces copiar llevaría el formato).

### 4. La columna del número de fila reutiliza las marcas

La columna nueva (44 px) va antes de las de datos en los tres estilos. Muestra
`viewPos + 1` y una casilla `role="checkbox"` con `aria-checked`, que llama al
mismo camino que Ctrl+clic (`toggleMark(rowIndex)`). La casilla de la cabecera
marca o desmarca todas las filas visibles, igual que Ctrl+A. En modo edición,
la columna de borrar sigue siendo la suya y va a la derecha del número. El
gesto de marcar no cambia la celda seleccionada.

*Alternativa descartada:* una casilla fija en cada fila. Añade ruido a la
rejilla, que es justo lo que se quiere quitar; al pasar el ratón y con la fila
marcada basta.

### 5. Llave dibujada

Se sustituye el emoji `🔑` por `IconKey` en `components/icons.tsx`, un SVG de
Lucide transcrito a mano como el resto del sistema de iconos, con color
`--super`. `.visually-hidden` conserva el nombre accesible.

### 6. Colores por tipo: los mismos tokens y tres reglas

Los tokens `--cell-*` no cambian:

- **Registro:** `.cell-text` vuelve a `--text`; el resto de tipos conserva su
  color.
- **Hoja densa:** todos los tipos con color, como hoy.
- **Informe:** celdas en `--text`, y la raya de la cabecera toma
  `--cell-<kind>` mediante una variable `--k` que `ResultGrid` fija en línea en
  cada cabecera.

`data-cell-colors="off"` sigue ganando en los tres estilos: las celdas pasan a
tinta y la raya a `--border`.

### 7. Ajustes

`GridStyle = "registro" | "hoja" | "informe"`. `parseSettings` es tolerante,
como con el resto de campos. En `SettingsPanel`, «Estilo de rejilla» va encima
de «Densidad del grid», con los mismos chips `role="radio"` y una frase bajo el
grupo que describe el estilo elegido.

## Risks / Trade-offs

- **[Riesgo] Cambiar el predeterminado sorprende a quien ya usa la app** → La
  nota de la versión lo anuncia y dice dónde elegir Hoja densa, que es la más
  parecida al aspecto actual.
- **[Riesgo] Una columna `float` con notación científica (`1.5e10`) o una
  `timestamp` con zona** → No encaja con las expresiones y se muestra tal cual.
  Hay pruebas para ambos casos.
- **[Riesgo] Anchos medidos con el texto formateado hacen la columna más ancha
  en Informe que en Registro** → Aceptado: medir con el texto que se ve es lo
  correcto. Cambiar de estilo recalcula los anchos, salvo los que el usuario
  ajustó a mano en esa rejilla.
- **[Riesgo] La columna del número de fila se come 44 px en tablas anchas** →
  Es el precio de marcar sin teclado. Ctrl/Shift+clic siguen funcionando igual.
- **[Trade-off] Separador fijo (coma y punto) en vez del del locale** → Lo que
  se ve y lo que se copia leen igual. Si alguien lo pide, el locale se puede
  añadir como otro ajuste.

## Migration Plan

Sin migración: un ajuste ausente vale Registro. Se entrega en tres PRs (ver
tasks.md), cada una con `pnpm test` y `pnpm e2e` en verde. Para revertir basta
con revertir los PRs; el campo `gridStyle` que quede guardado se ignora.

## Open Questions

- ¿Informe debe formatear también los enteros de columnas que son
  identificadores (`id`, claves)? Propuesta: no formatear las columnas de clave
  primaria ni de clave foránea, porque `1,024` como id confunde.
  **Estado (fase A):** `groupThousands` agrupa **desde cuatro dígitos**, como
  enseña el prototipo (`1,250.00`). Intenté exceptuar los cuatro dígitos para
  salvar los años y es incoherente: `1250` y `2024` tienen la misma longitud, así
  que por longitud no se distinguen un año y un saldo. Distinguirlos pide la
  **columna**, no el valor, y esa metadata la tiene la rejilla, no este módulo
  puro. Queda para la fase C, donde `ResultGrid` ya conoce la PK y las FK.
- ¿Merece un atajo o una entrada en la paleta (`Ctrl+K`) para cambiar de estilo
  sin ir a Ajustes? Propuesta: entrada en la paleta, sin atajo.
