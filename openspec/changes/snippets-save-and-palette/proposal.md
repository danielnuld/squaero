## Why

Los snippets existen desde #129 y la lógica pura está bien puesta, pero el
camino hasta ellos cuesta más que reescribir la consulta: guardar exige abrir una
pestaña que **tapa el editor**, nombrar, guardar y cerrar; recuperar es recorrer
una lista sin buscador; e insertar es lo único que se puede hacer con uno.

El caso que lo motiva es el más común de todos: acabo de escribir una consulta
que funciona y la quiero conservar sin salir de donde estoy (#320).

De las tres direcciones que se estudiaron —barra lateral acoplada, todo por
teclado, biblioteca maestro-detalle— esta cubre la del teclado, que es la que
resuelve el uso diario y la que menos interfaz nueva pide: la paleta ya existe y
ya tiene modos. La biblioteca (editar el cuerpo, etiquetas, duplicar) va en un
cambio aparte.

## What Changes

- **Guardar desde el editor**: un botón en la barra y
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> guardan **lo mismo que se
  ejecutaría** —selección, sentencia bajo el cursor o documento— reutilizando
  `pickRunTarget` y el mismo camino de ticks que el botón Ejecutar.
- El nombre se escribe **en la propia barra**, ya enfocado y con un nombre
  propuesto a partir de la tabla que lee la consulta (`queryEditTarget`).
  <kbd>Enter</kbd> acepta, <kbd>Esc</kbd> cancela.
- Confirmación en el aviso global que ya existe, diciendo qué alcance se guardó y
  con **Deshacer**.
- Un nombre repetido **no destruye nada**: se guarda con sufijo numerado y el
  aviso lo dice.
- **Paleta de snippets** con <kbd>Ctrl</kbd>+<kbd>J</kbd>: un tercer valor de
  `paletteMode`, con vista previa del cuerpo e <kbd>Enter</kbd> insertar /
  <kbd>Shift</kbd>+<kbd>Enter</kbd> ejecutar / <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
  abrir en pestaña nueva.
- Todo el texto nuevo pasa por `t()`, con espejo en inglés.

## Capabilities

### New Capabilities

- `snippet-capture`: conservar una consulta desde donde se escribe — qué trozo se
  guarda, cómo se nombra, y qué pasa con los nombres repetidos.
- `snippet-recall`: encontrar un snippet guardado y hacer algo con él sin
  abandonar el editor.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío.

## Impact

- **Solo frontend.** `App.tsx` (atajos, modo de paleta, acciones),
  `components/SqlEditor.tsx` (tick de guardado, como el de ejecutar),
  `components/CommandPalette.tsx` (vista previa y acciones con modificador),
  `utils/snippets.ts` (nombre propuesto y desambiguación), `utils/shortcuts.ts`,
  y los dos ficheros de mensajes.
- **Sin cambios de modelo**: se guarda el mismo `{ id, name, body }` de hoy. Las
  etiquetas y el motor llegan con la biblioteca.
- **Riesgo bajo y acotado a dos atajos nuevos**; ambos libres hoy en
  `matchShortcut`, y visibles en <kbd>F1</kbd> como el resto.
- Fuera de alcance, cada uno su issue: editar el cuerpo y etiquetar, huecos
  `${…}`, snippets en el autocompletado, orden por uso reciente.
- Issue relacionado: #320 (diseño), #129 (origen).
