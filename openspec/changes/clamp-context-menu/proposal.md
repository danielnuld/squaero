## Why

El menú de exportar se sale de la pantalla (#318). El ceñido al viewport ya está
escrito, pero mide dentro de un *callback ref* y en Solid el ref corre con el
elemento aún desconectado del DOM: un elemento desconectado mide 0×0, así que
`Math.min(x, innerWidth - 0 - 4)` devuelve siempre la posición cruda del clic. El
ceñido nunca se aplica, ni en horizontal ni en vertical, y afecta a **todos** los
menús contextuales: exportar, sincronizar, el del árbol y el de la rejilla.

Se nota con el menú de exportar porque su botón vive al extremo derecho de la
barra de objeto, y el menú mide 180 px de ancho mínimo.

## What Changes

- La medición pasa a un efecto, ya montado el elemento, de modo que el menú se
  ciñe de verdad al viewport: no se sale por la derecha ni por abajo, y nunca
  queda por encima ni a la izquierda del margen.
- La aritmética del ceñido se extrae a una función pura (posición del clic,
  tamaño del menú, tamaño del viewport → posición final) con pruebas, que es lo
  que hoy no está cubierto por nada.

## Capabilities

### New Capabilities

- `context-menu-placement`: dónde se coloca un menú contextual respecto del clic
  y de los bordes de la ventana.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío.

## Impact

- **Solo frontend**, dos archivos: `components/ContextMenu.tsx` y
  `utils/contextMenu.ts` (la función pura), más sus pruebas.
- **Sin riesgo de regresión visible** salvo el propio movimiento del menú: hoy
  aparece exactamente en el clic, y cerca de un borde pasará a desplazarse hacia
  dentro.
- Issue relacionado: #318.
