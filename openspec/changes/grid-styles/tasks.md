# Tareas

Una fase = un PR. Cada fase queda en verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente. Plano: artboard «Prototipo · conexiones y
rejilla» del lienzo https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2 (selector
«Rejilla»).

## 1. Lógica pura (fase A)

- [x] 1.1 `utils/settings.ts`: `GridStyle`, `gridStyle` en `Settings` y
      `DEFAULT_SETTINGS`, `parseSettings` tolerante (ausente o desconocido →
      `registro`)
- [x] 1.2 `rowHeightFor(style, density)` con la tabla fija; actualizar sus
      llamadas en `App.tsx`
- [x] 1.3 `utils/gridDisplay.ts`: `displayText(value, type, style, t)` —
      miles sobre la cadena, fechas ISO con mes abreviado desde el catálogo,
      todo lo demás tal cual, delega en `formatCell` fuera de Informe
- [x] 1.4 Pruebas: ajustes antiguos y valor desconocido, tabla de alturas,
      números (enteros, negativos, decimales con ceros, `bigint` más allá de
      2^53, notación científica), fechas (`date`, `timestamp`, no ISO de
      Informix, con zona), NULL, booleanos, español e inglés
- [x] 1.5 **Decisión cambiada**: se agrupan los miles **desde cuatro dígitos**,
      como enseña el prototipo (`1,250.00`). Exceptuar los de cuatro para salvar
      los años es incoherente (`1250` y `2024` miden lo mismo); distinguirlos
      pide la **columna**, no el valor

## 2. Estructura común y estilo Registro (fase B)

- [x] 2.1 `IconKey` en `components/icons.tsx`; la cabecera usa el icono en lugar
      del emoji y conserva el nombre accesible
- [x] 2.2 Cabecera con nombre y tipo en elementos separados; variable `--k` por
      columna con el color de su tipo
- [x] 2.3 Columna del número de fila: número, casilla `role="checkbox"` que llama
      al mismo `toggleMark` que Ctrl+clic y casilla de cabecera que marca o
      desmarca las visibles; en edición convive con la columna de borrar —
      adelantada fuera de este cambio, en el PR de la rama
      `feat/517-row-mark-checkbox` (seguimiento de #517): casilla nativa, solo en
      rejillas con `onMarkedRowsChange`, Mayús+clic marca el rango, y la columna
      cuenta en `aria-colcount`
- [x] 2.4 NULL en su propio `span` con la clase de etiqueta
- [x] 2.5 `App.tsx` pone `data-grid-style` en la raíz; CSS de Registro (texto en
      tinta, color solo en número, fecha, booleano y binario, etiqueta NULL,
      cifras tabulares)
- [x] 2.6 Pruebas de componente: los tres estilos, el valor crudo en el `title`,
      cambiar de estilo sin recargar, NULL como etiqueta, llave accesible
- [x] 2.7 **Tres defectos que solo se vieron mirando o ejecutando**: (a) la
      columna `id` perdía su nombre bajo la llave — el ancho no contaba las
      marcas de la cabecera Y el `margin-left:auto` del glifo de orden repartía
      el **alto** al pasar a dos líneas; (b) devolver el texto a tinta pisaba el
      color elegido por el usuario (lo cazó el e2e) → `--cell-text-chosen`;
      (c) medir leyendo las columnas clave hacía que el efecto que **resetea la
      vista** borrara los filtros en mitad de una edición en Informix →
      medición sin rastrear

## 3. Hoja densa, Informe y ajustes (fase C)

- [x] 3.1 CSS de Hoja densa: cuadrícula completa, cabecera en una línea con
      pastilla de tipo, color en todos los tipos
- [x] 3.2 CSS de Informe: sin líneas verticales, raya `--k` bajo la cabecera
      (`--border` con colores apagados), celdas en tinta
- [x] 3.3 `ResultGrid` muestra `displayText` y deja `title` con el valor crudo;
      `computeColumnWidths` mide con el texto mostrado
- [x] 3.4 `SettingsPanel`: «Estilo de rejilla» con chips `role="radio"` y la
      frase del estilo elegido, encima de la densidad
- [x] 3.5 Pruebas del selector y de los tres estilos dibujados; el `title`
      conserva el crudo y cambiar de estilo no re-ejecuta la consulta
- [ ] 3.6 **Preguntas abiertas, sin resolver todavía**: (a) si Informe debe
      dejar sin formatear las columnas de clave — hoy un año en una columna
      numérica se ve `2,024`, y arreglarlo pide mirar la PK/FK desde
      `ResultGrid`, que sí las conoce; (b) si merece una entrada en la paleta
      para cambiar de estilo sin ir a Ajustes

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
