# Tareas

Una fase = un PR. Cada fase queda en verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente. Plano: artboard «Prototipo · conexiones y
rejilla» del lienzo https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2 (selector
«Rejilla»).

## 1. Lógica pura (fase A)

- [ ] 1.1 `utils/settings.ts`: `GridStyle`, `gridStyle` en `Settings` y
      `DEFAULT_SETTINGS`, `parseSettings` tolerante (ausente o desconocido →
      `registro`)
- [ ] 1.2 `rowHeightFor(style, density)` con la tabla fija; actualizar sus
      llamadas en `App.tsx`
- [ ] 1.3 `utils/gridDisplay.ts`: `displayText(value, type, style, lang)` —
      miles sobre la cadena, fechas ISO con mes abreviado desde el catálogo,
      todo lo demás tal cual, delega en `formatCell` fuera de Informe
- [ ] 1.4 Pruebas: ajustes antiguos y valor desconocido, tabla de alturas,
      números (enteros, negativos, decimales con ceros, `bigint` más allá de
      2^53, notación científica), fechas (`date`, `timestamp`, no ISO de
      Informix, con zona), NULL, booleanos, español e inglés

## 2. Estructura común y estilo Registro (fase B)

- [ ] 2.1 `IconKey` en `components/icons.tsx`; la cabecera usa el icono en lugar
      del emoji y conserva el nombre accesible
- [ ] 2.2 Cabecera con nombre y tipo en elementos separados; variable `--k` por
      columna con el color de su tipo
- [x] 2.3 Columna del número de fila: número, casilla `role="checkbox"` que llama
      al mismo `toggleMark` que Ctrl+clic y casilla de cabecera que marca o
      desmarca las visibles; en edición convive con la columna de borrar —
      adelantada fuera de este cambio, en el PR de la rama
      `feat/517-row-mark-checkbox` (seguimiento de #517): casilla nativa, solo en
      rejillas con `onMarkedRowsChange`, Mayús+clic marca el rango, y la columna
      cuenta en `aria-colcount`
- [ ] 2.4 NULL en su propio `span` con la clase de etiqueta
- [ ] 2.5 `App.tsx` pone `data-grid-style` en la raíz; CSS de Registro (texto en
      tinta, color solo en número, fecha, booleano y binario, etiqueta NULL,
      cifras tabulares)
- [ ] 2.6 Pruebas de componente: marcar desde la casilla alimenta `markedRows`,
      casilla de cabecera ≡ Ctrl+A, NULL frente a cadena vacía, llave accesible

## 3. Hoja densa, Informe y ajustes (fase C)

- [ ] 3.1 CSS de Hoja densa: cuadrícula completa, cabecera en una línea con
      pastilla de tipo, color en todos los tipos
- [ ] 3.2 CSS de Informe: sin líneas verticales, raya `--k` bajo la cabecera
      (`--border` con colores apagados), celdas en tinta
- [ ] 3.3 `ResultGrid` muestra `displayText` y deja `title` con el valor crudo;
      `computeColumnWidths` mide con el texto mostrado
- [ ] 3.4 `SettingsPanel`: «Estilo de rejilla» con chips `role="radio"` y la
      frase del estilo elegido, encima de la densidad
- [ ] 3.5 Pruebas: copiar fila y celda, copiar como INSERT, filtrar y editar en
      Informe operan sobre el valor crudo; el tooltip muestra el crudo; cambiar
      de estilo no vuelve a ejecutar la consulta; `data-cell-colors="off"`
      gana en los tres estilos
- [ ] 3.6 Resolver las preguntas abiertas del diseño (formatear claves en
      Informe, entrada en la paleta) antes de cerrar la fase

## 4. Temas e idioma

- [ ] 4.1 Los tres estilos revisados en claro, oscuro, Ciruela, Pizarra y
      Terminal; la guardia de contraste sigue en verde
- [ ] 4.2 Todo el texto nuevo por `t()` con espejo en `messages/en.ts`, incluidos
      los meses abreviados; `SettingsPanel` sigue la receta de i18n existente
- [ ] 4.3 Recorrer los tres estilos con la app en inglés

## 5. Cierre

- [ ] 5.1 `pnpm test` y `pnpm typecheck` en verde en las tres fases
- [ ] 5.2 `pnpm e2e` **entero** en verde en las tres fases
- [ ] 5.3 Probado a mano en la ventana nativa (WebView2, build x86) contra el
      contenedor MySQL de pruebas y contra Informix: cambiar de estilo con una
      tabla de miles de filas (scroll y navegación con teclado sin
      desalineación), marcar desde la casilla y copiar, fechas de Informix en
      Informe
- [ ] 5.4 Capturas del sitio y del manual regeneradas (`pnpm media`); el manual
      explica el ajuste
- [ ] 5.5 Nota de la versión: nuevo aspecto predeterminado y dónde elegir Hoja
      densa
- [ ] 5.6 Commits en Conventional Commits referenciando el issue del cambio
