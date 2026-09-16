## Why

La rejilla de resultados es donde más tiempo pasa quien usa Squaero, y hoy tiene
un solo aspecto, genérico. Hay columnas separadas con líneas en todas las
celdas, el texto de cada tipo en un color distinto, la llave de la clave primaria
es un emoji 🔑 y NULL es una palabra en cursiva. La densidad ya se puede
elegir (#181) y los colores por tipo se pueden apagar (#483), pero no hay forma
de cambiar **cómo se lee** la rejilla.

En el lienzo de diseño se probaron tres formas de leerla, y las tres sirven para
usos distintos. Quien revisa datos de producción fila a fila no quiere lo mismo
que quien compara muchas columnas o prepara números para enseñarlos. En vez de
elegir una, se ofrecen las tres como un ajuste.

## What Changes

- **Nuevo ajuste «Estilo de rejilla»** en Ajustes → Estilo, junto a la densidad
  y los colores por tipo, con tres valores:
  - **Registro** (predeterminado): columna de número de fila que al pasar el
    ratón se convierte en casilla para marcar; cabecera en dos líneas (nombre
    arriba, tipo debajo); llave dibujada en SVG; números alineados a la
    derecha con cifras tabulares; NULL como etiqueta; el texto en tinta y el
    color reservado a números, fechas, booleanos y binarios.
  - **Hoja densa**: cuadrícula completa, filas más bajas, cabecera en una línea
    con el tipo en una pastilla y color en todos los tipos, incluido el texto.
  - **Informe**: sin líneas verticales, filas más altas, el color del tipo
    como una raya bajo la cabecera y los datos en tinta. **Formatea en pantalla**
    los números (separador de miles) y las fechas (`14 feb 2023`).
- **Lo que se copia, filtra, exporta o edita es siempre el valor crudo**, en los
  tres estilos. El formato de Informe solo cambia lo que se ve, y el valor crudo
  queda en el tooltip de la celda.
- **La densidad sigue siendo independiente**: cada estilo tiene su altura
  normal y su altura compacta, y la virtualización usa la del estilo activo.
- **Los colores por tipo siguen pudiéndose apagar** en los tres estilos. En
  Informe, apagarlos pone la raya de la cabecera en gris.
- **La columna del número de fila marca filas** con el mismo conjunto de
  marcas que ya usan Ctrl/Shift+clic y Ctrl+A (#382). No es otro modo de
  selección.

## Capabilities

### New Capabilities

- `grid-styles`: elegir cómo se presenta la rejilla de resultados (Registro,
  Hoja densa o Informe), que se aplica igual a todas las rejillas de datos y
  nunca altera los valores que salen de ella.

### Modified Capabilities

Ninguna: no hay specs previas de la rejilla en `openspec/specs/`.

## Impact

- **Solo frontend.**
  - `utils/settings.ts`: `gridStyle` y `rowHeightFor(style, density)`.
  - Módulo puro nuevo `utils/gridDisplay.ts`: texto mostrado según el estilo.
  - `components/ResultGrid.tsx`: columna de número de fila, cabecera, etiqueta NULL y texto mostrado.
  - `components/SettingsPanel.tsx`.
  - `App.tsx`: atributo `data-grid-style` en la raíz y altura de fila.
  - `components/icons.tsx`: llave.
  - `styles.css` y los dos catálogos de mensajes.
- **Sin cambios de IPC ni del core.** Los ajustes guardados sin `gridStyle`
  cargan como Registro.
- **Cambio visible para todos**: Registro sustituye al aspecto actual como
  predeterminado. Hoja densa es la más parecida al actual.
- **Pruebas afectadas:** `ResultGrid.test.tsx`, `SettingsPanel.test.tsx`,
  `settings.test.ts` y `settingsStore.test.ts`. El e2e se ejecuta entero, porque
  la rejilla está en casi todos los recorridos.
- **Capturas del sitio y del manual**: hay que regenerarlas (`pnpm media`).
- Fuera de alcance, cada uno en su cambio: pegar filas copiadas como filas nuevas
  sin guardar (el flujo de la barra flotante del mismo prototipo), el rediseño
  de la barra de conexiones, un estilo por conexión o por pestaña, y estilos
  definidos por el usuario.
