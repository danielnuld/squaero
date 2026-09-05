# Sitio (landing page) — GitHub Pages

Landing page de Squaero. Sitio **estático puro** (HTML/CSS, sin frameworks, sin
paso de build) para poder publicarse en **GitHub Pages clásico por rama**, sin
depender de GitHub Actions.

## Estructura

```
site/
  index.html      # español (por defecto): hero, características, comparativa, descargas
  en/index.html   # inglés (misma página, /quaero/en/)
  manual/index.html  # manual de usuario (ES) — /quaero/manual/
  styles.css      # CSS compartido por ambos idiomas (sin drift)
  assets/         # logo + wordmark (SVG, copiados de assets/brand/)
  img/            # social preview + capturas (de assets/media/)
  video/          # demo del flujo principal (webm + mp4 + póster)
  .nojekyll       # evita el procesado Jekyll (servir los archivos tal cual)
```

**Idiomas.** El sitio es bilingüe: `index.html` (ES, en `/quaero/`) y
`en/index.html` (EN, en `/quaero/en/`). Ambos enlazan el mismo `styles.css` (la
página EN con `../styles.css`) y llevan un selector de idioma en el nav
(`ES`/`EN`) + `<link rel="alternate" hreflang>` recíprocos para SEO. Al traducir
o cambiar contenido, edita **las dos** páginas; los assets se referencian con
`../` desde `en/`.

- Idioma: **español** primero; el marcado está listo para una variante EN.
- Tema **claro/oscuro** automático (`prefers-color-scheme`), con la paleta de
  marca (índigo `#5b5bd6` / `#7c7cf0`).
- Responsive (móvil y escritorio).
- Metadatos **OpenGraph/Twitter** apuntando a `img/social-preview.png`.

## Manual de usuario (`site/manual/`)

Guía por tareas («cómo hago X»), **una sola página** con índice pegajoso a la
izquierda y un ancla por sección — así se busca con Ctrl+F, se enlaza en
profundidad y no hay que duplicar el `<nav>` en N archivos sin un paso de build.
Usa el mismo `styles.css` que la landing (bloque `/* Manual */` al final), así
que hereda paleta, tema claro/oscuro y tipografía sin drift.

Está **solo en español**: el espejo EN se traduce cuando el contenido se
estabilice, igual que se hizo con la landing (`site/manual/en/index.html`, con
su selector de idioma y sus `hreflang` recíprocos en ambas páginas).

Las capturas se referencian desde `../img/` — son las mismas que la landing, no
un juego aparte.

## Editar

Edita `site/index.html` directamente. Las imágenes se copian desde las fuentes
de marca/medios para que el sitio sea autocontenido:

```
cp assets/brand/quaero-mark.svg          site/assets/
cp assets/brand/quaero-wordmark*.svg     site/assets/
cp assets/media/social-preview.png       site/img/
cp assets/media/screenshot-*.png         site/img/
```

Las capturas se **regeneran**, no se editan a mano:
`cd frontend && pnpm media` las vuelve a tomar contra una base de datos real
(ver `frontend/e2e/media/screenshots.spec.ts`). Después de regenerarlas hay que
copiarlas a `site/img/` con la orden de arriba.

Previsualiza en local abriendo `site/index.html` en el navegador, o:
`python -m http.server -d site 8080` → http://localhost:8080

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

> Alternativa equivalente: *Source = main, carpeta `/docs`* — no se usa aquí
> porque `/docs` ya contiene la documentación de desarrollo.

## Video demo (#203)

`site/video/quaero-demo.webm` (VP9) + `.mp4` (H.264) + `quaero-demo-poster.png`,
incrustados en la sección de características con `<video autoplay muted loop
playsinline>` y una `<img>` de respaldo dentro del `<video>`. ~22 s, ~370 KB,
alojado en el repo (no en servicios externos). Dos formatos porque el `<video>`
lista los dos: WebM/VP9 pesa menos, MP4/H.264 es lo que reproduce Safari.

**Se regraba, no se edita:**

```
docker start quaero-demo-mysql       # la BD del demo (ver e2e/support/demo.ts)
cd frontend && pnpm video            # graba, codifica y escribe el póster
```

`e2e/media/video.spec.ts` conduce el frontend real contra el **núcleo y una base
de datos reales** siguiendo el guion de abajo, y `e2e/media/build-video.mjs`
codifica con ffmpeg (hace falta ffmpeg en el PATH). El póster no se recorta de un
cuadro: lo escribe el propio spec en el instante que describe, la consulta con sus
resultados.

**Guion:**
1. **Conectar** — elegir la conexión guardada «Ventas (demo)».
2. **Explorar** — expandir el árbol (base → Tablas) y abrir la estructura de una
   tabla desde su menú contextual (columnas, tipos y DDL).
3. **Consultar** — pestaña nueva, escribir un `SELECT … WHERE … ORDER BY` y
   ejecutarlo; se ve el autocompletado por esquema y la rejilla tipada.
4. **Herramientas** — Diagrama ER (llaves foráneas reales) y constructor visual.

Los subtítulos se inyectan en la página, así van sincronizados con lo que
describen sin trabajo extra: el vídeo se reproduce en silencio y en bucle, así que
son la única narración.

**Dos cosas que no se pueden dar por hechas:**

- El vídeo **antiguo** se grabó con un harness de `puppeteer-core` y un
  `window.quaeroRpc` **simulado** — nada de lo que salía en pantalla tenía que
  funcionar de verdad. Ahora cada fila y cada diagrama vienen de una base de datos,
  así que el vídeo no puede prometer algo que el producto no haga.
- La grabación arranca al crear el contexto del navegador, o sea **antes** de que
  la app pinte, así que empieza en blanco. Cuánto dura eso depende de la máquina:
  `build-video.mjs` **mide** el primer cuadro pintado (luma media por `signalstats`)
  en vez de recortar una cantidad fija, y después comprueba que el archivo generado
  no abre en blanco. Un solo cuadro blanco no se ve en un listado de archivos y
  destella en cada vuelta del bucle.

## Pendiente (issues del milestone M10.10)

- **#201** La comparativa ya trae **fuentes + fecha de revisión** por competidor
  (verificable). Falta la **aprobación de copy del propietario** antes de publicar.
- **#202** Sustituir/añadir capturas reales por módulo desde el kit de medios
  (`assets/media/`, ver [MEDIA-KIT](../assets/media/MEDIA-KIT.md)); hoy hay el
  social preview, la pantalla inicial y la galería de módulos.
