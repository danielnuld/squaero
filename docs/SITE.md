# Sitio (landing page) — GitHub Pages

Landing page, manual y política de privacidad de Squaero. Sitio **estático puro**
(HTML y CSS, sin frameworks ni paso de build) para publicarse en **GitHub Pages
clásico por rama**, sin depender de GitHub Actions. El JavaScript solo mejora:
sin él todo se lee y todas las descargas funcionan.

## Dirección visual: Liquid Glass (M16, #748)

Decisión de la fase 0 del milestone M16. De las direcciones exploradas (Main,
Bento, Brutal y Glass) se eligió **Liquid Glass**: superficies translúcidas sobre
dos brillos suaves, en los cuatro estilos del rediseño M14
([docs/design/m14](design/m14/README.md)).

- **Maqueta de referencia:** [`design/m16/Glass.dc.html`](design/m16/Glass.dc.html)
  (Design Component: HTML con huecos `{{…}}` y una clase de lógica). Contiene la
  estructura, el orden de las secciones, el texto y las recetas de vidrio. El
  sitio es su traducción a HTML y CSS estáticos; donde el texto de la maqueta
  prometía algo que la app no hace (una «corrección sugerida» en los
  diagnósticos, el botón «Detener»), el sitio dice lo que la app hace.
- **Estilos:** B · Nativo (claro, predeterminado), A · Quiet pro (oscuro),
  C · Editorial (oscuro cálido) y Rosa pastel. Sin JavaScript, la página es B, o A
  si el sistema está en oscuro (`prefers-color-scheme`). Con JavaScript, el
  selector de la barra pone `data-style` en `<html>` y lo recuerda en
  `localStorage` (clave `squaero-style`); `style.js` se carga en el `<head>` para
  aplicarlo antes del primer pintado.
- **Vidrio:** fondo `rgb(surface / 0.55)` (0.45 en oscuro), borde claro de 1 px,
  brillo interior arriba y `backdrop-filter: blur(24px) saturate(180%)`; la
  variante fuerte usa 0.72 / 0.70. Los dos brillos son degradados radiales del
  fondo (acento y un segundo color por estilo), así que no pueden desbordar la
  página. Con `prefers-reduced-transparency: reduce`, o si el navegador no tiene
  `backdrop-filter`, el vidrio pasa a ser la superficie opaca.
- **Movimiento:** solo el pequeño desplazamiento al pasar el ratón sobre tarjetas y
  botones, y el desplazamiento suave a las anclas; los dos se apagan con
  `prefers-reduced-motion`. Sin vídeos en reproducción automática.
- **Tipografía:** Geist para la interfaz en B y A, IBM Plex Sans en C y Figtree en
  Rosa; la monoespaciada de cada estilo (JetBrains Mono, Geist Mono, IBM Plex
  Mono). Autoalojadas en `site/fonts/` (woff2, subconjunto latino, con su licencia
  OFL al lado); el sitio no pide nada a Google ni a otro tercero. El navegador solo
  descarga las del estilo en uso.
- **Contraste:** WCAG 2.2 AA en los cuatro estilos, medido en el peor caso: texto
  sobre el fondo y sobre el vidrio, bajo uno o los dos brillos en su opacidad
  máxima. Texto 4,5:1; bordes de controles, relleno del botón principal y subrayado
  de error 3:1. Lo comprueba `node scripts/site-contrast.mjs`, que lee los tokens
  de `site/site.css` (y falla si un par baja de AA o si el oscuro automático no es
  igual que A). Respecto a la maqueta, se oscurecieron el texto secundario de B, C
  y Rosa, el texto de acento de B y Rosa y el acento de Rosa (`#b9406f`), y los
  brillos bajaron a 0.20–0.24.

## Estructura

```
site/
  index.html          # español (por defecto)
  en/index.html       # inglés, mismo contenido
  manual/index.html   # manual de usuario (solo ES) + manual/toc.js
  privacidad/         # política de privacidad (ES)
  en/privacy/         # política de privacidad (EN)
  site.css            # el único CSS: tokens, vidrio y todas las páginas
  style.js            # selector de estilo
  release.js          # versión, enlaces de descarga y SO detectado
  assets/             # isotipo y favicons (de assets/brand/)
  fonts/              # woff2 + licencias OFL
  img/                # vista previa social y capturas (AVIF, WebP y PNG)
  video/              # demo antigua (ya no la usa la landing; la regenera pnpm video)
  .nojekyll
```

**Idiomas.** `index.html` (ES, `/squaero/`) y `en/index.html` (EN,
`/squaero/en/`) tienen las mismas secciones y anclas propias en cada idioma
(`#motores` / `#engines`, `#descargar` / `#download`…). Al cambiar contenido,
edita **las dos**. Las políticas de privacidad también van en pareja. Cada
página lleva `canonical`, `hreflang` recíprocos (y `x-default` al español),
OpenGraph y, la landing, datos estructurados `SoftwareApplication` (JSON-LD).

**Secciones de la landing:** barra flotante; hero con la pastilla «Nuevo», la
descarga según el sistema y la ventana de la app dibujada en HTML (paleta de
comandos y aviso); «Un editor que entiende tu SQL»; «Trabaja tranquilo»
(modo seguro, transacciones, reconexión); motores; funciones; iPhone y MCP;
comparativa; descargas; pie.

**Descargas.** `release.js` pregunta a `api.github.com` por la última versión,
apunta cada botón a su archivo, pone la versión en el hero y el título, cambia
el botón principal del hero según el sistema (Windows, Mac o Linux) y resalta la
tarjeta de ese sistema (`data-os` → `.is-detected`). Sin JavaScript, o si GitHub
no responde, los botones llevan a la página de versiones.

## Identidad

Los archivos de `site/assets/` se **copian** de [`assets/brand/`](../assets/brand/BRAND.md)
(#679), no se dibujan aparte:

```
cp assets/brand/quaero-mark.svg        site/assets/quaero-mark.svg
cp assets/brand/quaero-mark-solid.svg  site/assets/favicon.svg
cp assets/brand/png/quaero-mark-16.png site/assets/favicon-16.png
cp assets/brand/png/quaero-mark-32.png site/assets/favicon-32.png
```

`apple-touch-icon.png` (180 px) es `quaero-mark-solid.svg` a sangre sobre el
verde del azulejo. En las páginas el isotipo va **en línea** (anillo en el color
del texto, cola y prompt en el acento) para seguir el estilo elegido; su
geometría es la de `assets/brand/quaero-mark.svg` (y la de tamaño pequeño, con
trazos 18/18/14, hasta 32 px).

`img/social-preview.png` (1280×640) es una captura del propio hero de la landing
en estilo B, con el logo encima, tomada con Playwright.

## Manual de usuario (`site/manual/`)

Guía por tareas, **una sola página** con un ancla por sección: se busca con
Ctrl+F y se enlaza en profundidad sin duplicar el índice en varios archivos. El
índice es un `<details>`: en escritorio queda fijo a la izquierda y siempre
abierto; en pantallas estrechas `toc.js` lo pliega y lo vuelve a plegar al saltar
a una sección (sin JavaScript, es una lista abierta). Los atajos usan `<kbd>`
con el mismo aspecto que en la app, y la tabla de atajos sigue
`frontend/src/utils/shortcuts.ts`.

Está **solo en español**; la versión EN se traduce cuando el contenido se
estabilice. Cada captura va en su sección como `<figure>` con un `<picture>`
(AVIF, WebP y el PNG de respaldo), `loading="lazy"`, `width`/`height` y un `alt`
que dice lo que se ve.

## Editar y previsualizar

Edita el HTML directamente. Previsualiza con
`python -m http.server -d site 8080` → http://localhost:8080 (abrir los archivos
con `file://` también sirve, salvo la consulta a GitHub).

Las capturas se **regeneran**, no se editan a mano, con un solo comando:

```
docker start quaero-demo-mysql && cd frontend && pnpm media
```

Escribe los PNG en `assets/media/` (los usa el README) y sus copias AVIF/WebP/PNG
en `site/img/` (`scripts/site-images.mjs`, con ffmpeg). Detalles y requisitos en
[`frontend/e2e/README.md`](../frontend/e2e/README.md#media-capture).

## Publicar (sin Actions)

Se publica desde una rama **`gh-pages`** cuya raíz es el contenido de `site/`.
El fuente vive en `main` (revisable por PR); publicar es copiar `site/` a la
raíz de `gh-pages`:

```
bash site/publish.sh
```

El script hace un commit de árbol de `site/` en `gh-pages` y lo empuja. Luego,
una sola vez, en **Settings → Pages** del repo: *Source = Deploy from a branch*,
*Branch = `gh-pages` / (root)*. La URL queda en
`https://danielnuld.github.io/squaero/`.

## Video demo (#203)

`site/video/` guarda la demo grabada contra una base real (`cd frontend && pnpm
video`, ver `e2e/media/video.spec.ts` y `build-video.mjs`). La landing de M16 ya
no la incrusta: el hero dibuja la ventana en HTML y #751 pide no reproducir vídeo
automáticamente. Se conserva porque el guion de grabación escribe ahí; se puede
volver a enlazar con un `<video controls>` cuando haya una del rediseño.

## Pendiente

- Vídeo demo del rediseño (#753): `pnpm video` sigue grabando el flujo anterior.
- Manual en inglés.
- Lighthouse (#755) se midió a mano, en móvil y servido en local (Lighthouse
  12.6, octubre de 2026): landing ES y EN 98 / 100 / 100 / 100 (rendimiento,
  accesibilidad, buenas prácticas, SEO), manual 99 / 100 / 100 / 100, privacidad
  100 en las cuatro. No hay un job que lo vigile.
