# Quaero — Guía de marca

Identidad visual de **Quaero**, el cliente de bases de datos multi‑motor.
Estos assets son la fuente única de verdad para el logo, los colores y la
tipografía. No re‑dibujes ni recolores el logo fuera de lo aquí documentado.

## Nombre

**Quaero** (del latín *quaero*: «yo busco, indago, pregunto»). El nombre alude
directamente a la acción de consultar. Escríbelo siempre capitalizado como
`Quaero` — nunca en mayúsculas (`QUAERO`) ni en minúsculas (`quaero`) salvo en
identificadores técnicos (paquetes, rutas, ejecutable `quaero`).

Tagline (ES): «Tu gestor de bases de datos: ligero, local y libre». Corta: «Ligero, local y libre».
Tagline (EN): «Your lightweight, local, open-source database client». Corta: «Lightweight. Local. Open source.»

## Logo

El isotipo es una **Q** cuyo anillo encierra un *prompt* de consulta (`›` +
cursor), evocando a la vez la inicial del nombre y una lupa de búsqueda.

| Archivo | Uso |
|---|---|
| `quaero-mark.svg` | Isotipo principal (trazo), fondos claros y oscuros. Tamaños medianos y grandes. |
| `quaero-mark-solid.svg` | Variante sólida con el prompt calado en blanco. **Úsala a ≤ 32px** (favicon, icono de ventana): permanece legible a 16px. |
| `quaero-mark-mono.svg` | Monocroma (`currentColor`). Para estampado a una tinta, sellos, watermark. Hereda el `color` del contenedor **solo si el SVG se incrusta inline** (o vía `<use>`); a través de `<img>` `currentColor` no se hereda y cae a negro. |
| `quaero-wordmark.svg` | Isotipo + palabra «Quaero» para **fondos claros**. |
| `quaero-wordmark-dark.svg` | Wordmark para **fondos oscuros** (índigo claro + texto claro). |
| `png/` | Rasterizaciones PNG del isotipo (16–512px) y del wordmark, fondo transparente. |

El isotipo funciona de **16px** (favicon, icono de ventana — usar la variante
sólida) a **tamaño grande** (README, landing).

### Área de protección y tamaño mínimo

- **Espaciado (clear space):** deja alrededor del logo un margen mínimo igual al
  radio del anillo de la Q (≈ ¼ del alto del isotipo). No coloques texto ni otros
  elementos dentro de esa zona.
- **Tamaño mínimo:** 16px para el isotipo (variante sólida); 96px de ancho para el
  wordmark completo (por debajo de eso usa solo el isotipo).

### Qué NO hacer

- No cambies los colores del logo fuera de la paleta de marca.
- No apliques sombras, contornos, degradados no documentados ni rotaciones.
- No re‑espacies ni sustituyas la tipografía del wordmark.
- No uses el isotipo de trazo por debajo de 32px (usa la variante sólida).

## Paleta

Color de acento primario de marca: **Índigo**. Todos los pares cumplen contraste
WCAG AA para su uso previsto.

| Rol | Claro (`#`) | Oscuro (`#`) | Uso |
|---|---|---|---|
| **Índigo (acento)** | `#5b5bd6` | `#7c7cf0` | Color de marca. Acento de UI, botones, selección, logo. |
| Texto sobre acento | `#ffffff` | `#1e1e24` | Color de texto/icono que va ENCIMA de un relleno de acento (`--accent-fg`). En claro, blanco sobre `#5b5bd6` = 5.4:1; en oscuro, tinta sobre `#7c7cf0` = 4.8:1. Ambos AA. |
| Índigo hover | `#4a4ac4` | `#9a9aff` | Estado hover/activo del acento (`--accent-hover`). |
| Tinta (texto) | `#1e1e24` | `#e6e6ec` | Texto del wordmark y titulares. |
| Papel (fondo) | `#f7f7fa` | `#1e1e24` | Fondo. |

> El acento se usa en la UI como la variable CSS `--accent` (ver el tema en
> `frontend/src/styles.css`). Los dos valores (`#5b5bd6` claro / `#7c7cf0`
> oscuro) son los oficiales de marca.

## Tipografía

- **Titulares / wordmark:** *Space Grotesk* (geométrica, técnica), peso 600, con
  `letter-spacing` ajustado. Fallback: `Segoe UI, system-ui, sans-serif`.
- **UI / cuerpo:** la pila del sistema (`system-ui`), como ya usa la aplicación.
- **Código / SQL:** monoespaciada del sistema.

> Nota: el `quaero-wordmark.svg` usa `<text>` con esa pila de fuentes para que el
> repositorio no dependa de binarios de fuente. Para distribución impresa o de
> alta fidelidad, convierte el texto a contornos (paths) en la herramienta de
> diseño. (Refinamiento pendiente, no bloqueante.)

## Regeneración de los PNG

Los PNG de `png/` se rasterizan desde los SVG (no se editan a mano). Con
cualquier rasterizador de SVG, por ejemplo:

```
rsvg-convert -w 256 -h 256 quaero-mark.svg      > png/quaero-mark-256.png
rsvg-convert -w 16  -h 16  quaero-mark-solid.svg > png/quaero-mark-16.png
```

(En este repo se generaron con Edge headless `--screenshot` sobre un envoltorio
HTML por falta de rasterizador CLI; cualquier método equivalente sirve.)
