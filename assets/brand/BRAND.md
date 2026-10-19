# Squaero — Guía de marca

Identidad visual de **Squaero**, el cliente de bases de datos multi‑motor.
Estos assets son la fuente única de verdad para el logo, los colores y la
tipografía. No re‑dibujes ni recolores el logo fuera de lo aquí documentado.

## Nombre

**Squaero** (del latín *quaero*: «yo busco, indago, pregunto»). El nombre alude
directamente a la acción de consultar. Escríbelo siempre capitalizado como
`Squaero` — nunca en mayúsculas (`QUAERO`) ni en minúsculas (`quaero`) salvo en
identificadores técnicos (paquetes, rutas, ejecutable `quaero`).

Tagline (ES): «Tu gestor de bases de datos: ligero, local y libre». Corta: «Ligero, local y libre».
Tagline (EN): «Your lightweight, local, open-source database client». Corta: «Lightweight. Local. Open source.»

## Logo

**Concepto A · Evolución** (#679). El isotipo es una **Q** —anillo + cola
diagonal— que encierra un *prompt* de consulta `›`: la inicial del nombre, una
lupa de búsqueda y la línea de comandos donde se escribe la consulta. Respecto
al logo anterior se quitó el cursor y se engrosó el trazo.

Geometría de referencia (viewBox 128×128, fuente única de verdad):

| Pieza | Forma | Trazo | Color |
|---|---|---|---|
| Anillo | `circle cx=58 cy=58 r=36` | 14 | tinta |
| Cola | `M84 84 L106 106`, extremo redondo | 14 | acento |
| Prompt `›` | `M50 44 L64 58 L50 72`, extremos y unión redondos | 10 | acento |

**Tamaño óptico:** a **≤ 32px** los trazos pasan a 18 (anillo y cola) y 14
(prompt) para que el isotipo siga legible a 16px.

### El color sigue al tema

En la aplicación el isotipo se dibuja inline (`BrandMark` / `BrandWordmark` en
`frontend/src/components/Brand.tsx`) y **toma los colores del estilo activo**:

- **anillo** (y el texto del wordmark) = color de texto del tema (`--text`);
- **prompt + cola** = acento del tema (`--accent`).

Así el logo es teal en B · Nativo, ámbar en C · Editorial, rosa en Rosa pastel,
etc. Los archivos estáticos de este directorio usan los colores de **B · Nativo**,
el estilo predeterminado. Los **iconos del sistema operativo** (Windows, macOS,
Linux, iOS) no pueden seguir el tema y van **fijos al azulejo B · Nativo**:
cuadrado redondeado teal `#0f7b72` (radio ≈ 22,5 %), anillo blanco, prompt y
cola menta `#a6ebe0` (ver [`assets/icons/`](../icons/README.md)).

| Archivo | Uso |
|---|---|
| `quaero-mark.svg` | Isotipo para **fondos claros**: tinta `#14181d` + teal `#0f7b72`. De 48px en adelante. |
| `quaero-mark-dark.svg` | Isotipo para **fondos oscuros**: tinta `#e6e9ee` + teal `#3fb8a9`. De 48px en adelante. |
| `quaero-mark-solid.svg` | Azulejo B · Nativo con trazos ópticos. **Úsalo a ≤ 32px** (favicon, icono de ventana): legible a 16px sobre cualquier fondo. |
| `quaero-mark-mono.svg` | Monocromo (`currentColor`). Para estampado a una tinta, sellos, watermark. Hereda el `color` del contenedor **solo si el SVG se incrusta inline** (o vía `<use>`); a través de `<img>` `currentColor` no se hereda y cae a negro. |
| `quaero-wordmark.svg` | Isotipo + «Squaero» para **fondos claros**. |
| `quaero-wordmark-dark.svg` | Isotipo + «Squaero» para **fondos oscuros**. |
| `png/` | Rasterizaciones PNG: isotipo 16–512px (16 y 32 desde el azulejo, el resto desde `quaero-mark.svg`) y los dos wordmarks a 2×, fondo transparente. |
| `../icons/quaero-app-icon.svg` | Azulejo del icono de aplicación (≥ 48px) del que salen `.ico`, `.icns` y hicolor. |

### Área de protección y tamaño mínimo

- **Espaciado (clear space):** deja alrededor del isotipo un margen mínimo igual
  a la mitad del radio del anillo: 18 unidades del viewBox 128 (≈ 14 % del lado). En el wordmark, la misma medida alrededor del conjunto.
- **Tamaño mínimo:** 16px para el isotipo (azulejo sólido o trazos ópticos);
  el isotipo de trazo normal desde 48px; el wordmark completo desde **96px de
  ancho** (por debajo usa solo el isotipo).

### Qué NO hacer

- No uses colores fuera de la regla: el anillo va en el color de texto y el
  prompt y la cola en el acento del estilo; nunca al revés ni los tres en acento.
- No vuelvas a añadir el cursor `|` ni separes el prompt del anillo.
- No apliques sombras, contornos, degradados ni rotaciones.
- No cambies la geometría ni los grosores fuera del tamaño óptico documentado.
- No uses el isotipo de trazo normal por debajo de 32px (usa `quaero-mark-solid.svg`
  o los trazos ópticos).
- No re‑espacies ni sustituyas la tipografía del wordmark.
- En los iconos del sistema no uses otro estilo que no sea B · Nativo.

## Paleta

La marca pasa del índigo al estilo **B · Nativo**, el predeterminado de M14.
Todos los pares cumplen contraste WCAG AA para su uso previsto.

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| **Tinta** | `#14181d` | `#e6e9ee` | Anillo del isotipo y texto del wordmark. |
| **Teal (acento)** | `#0f7b72` | `#3fb8a9` | Prompt y cola del isotipo; acento de UI en B · Nativo. |
| Menta (icono) | `#a6ebe0` | — | Prompt y cola sobre el azulejo teal de los iconos del sistema (3,8:1 sobre `#0f7b72`). |
| Blanco (icono) | `#ffffff` | — | Anillo sobre el azulejo teal (5,1:1). |

En la app el logo usa el acento del estilo activo:

| Estilo | Acento del logo |
|---|---|
| B · Nativo | `#0f7b72` |
| A · Quiet pro | `#3fb8a9` |
| C · Editorial | `#e0a43c` |
| Rosa pastel | `#c2477a` |

> El índigo anterior (`#5b5bd6` / `#7c7cf0`) deja de ser color de marca, pero
> los temas índigo heredados siguen seleccionables como temas de color (ver
> abajo); con ellos el logo se pinta en índigo, como cualquier otro acento.

## Estilos de la interfaz (M14)

Decidido en #678. La interfaz usa un solo layout (el rediseño M14) con **cuatro
estilos** que el usuario elige en Ajustes › Apariencia:

| Estilo | Carácter | Acento | Tipografía |
|---|---|---|---|
| **B · Nativo** (predeterminado) | Claro, integrado con el sistema | `#0f7b72` | Fuente del sistema + JetBrains Mono |
| **A · Quiet pro** | Oscuro frío | `#3fb8a9` | Geist + Geist Mono |
| **C · Editorial** | Oscuro cálido, etiquetas en minúscula | `#e0a43c` | IBM Plex Sans + IBM Plex Mono |
| **Rosa pastel** | Claro y suave | `#c2477a` | Figtree + JetBrains Mono |

El logo toma el acento del estilo activo (ver «Logo»). El índigo de la marca
anterior sigue en los temas integrados heredados («Squaero (índigo)», Azul,
Ciruela, Pizarra, Terminal, Alto contraste), que se conservan seleccionables
como temas de color. Los tokens completos, los
principios del layout y por qué se eligió esta dirección están en
[`docs/design/m14/`](../../docs/design/m14/README.md).

## Tipografía

- **Wordmark:** *Geist* peso 600, `letter-spacing` ≈ −0,045em (−2,8 a 62px).
  Fallback: `Segoe UI, system-ui, sans-serif`. Geist va empaquetada en la app
  (`frontend/src/assets/fonts/`, OFL 1.1). Sustituye a Space Grotesk.
- **UI / cuerpo:** la del estilo activo (sistema en B · Nativo; ver la tabla de
  estilos).
- **Código / SQL:** la monoespaciada del estilo activo.

> Nota: `quaero-wordmark*.svg` usan `<text>` con esa pila de fuentes, sin
> contornear, para que el repositorio no dependa de herramientas de diseño:
> donde Geist no esté instalada el SVG cae a la fuente de reserva. Los PNG de
> `png/` sí se rasterizan con Geist. Para impresión o alta fidelidad, convierte
> el texto a contornos en la herramienta de diseño.

## Regeneración de los PNG y los iconos

Los PNG de `png/` y los iconos de `assets/icons/` (`.ico`, `.icns`, hicolor)
se generan desde los SVG, no se editan a mano. Desde la raíz del repo, con
`pnpm install` hecho en `frontend/`:

```
node scripts/render-brand.mjs      # png/ + .ico/.icns/hicolor
node scripts/ios/render-icon.mjs   # icono y marca de arranque de iOS
```

Ambos rasterizan con el Chromium de Playwright (no hace falta otra herramienta);
`render-brand.mjs` carga Geist del frontend para el wordmark.
