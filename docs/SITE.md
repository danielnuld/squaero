# Sitio (landing page) — GitHub Pages

Landing page de Quaero. Sitio **estático puro** (HTML/CSS, sin frameworks, sin
paso de build) para poder publicarse en **GitHub Pages clásico por rama**, sin
depender de GitHub Actions.

## Estructura

```
site/
  index.html      # español (por defecto): hero, características, comparativa, descargas
  en/index.html   # inglés (misma página, /quaero/en/)
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

## Editar

Edita `site/index.html` directamente. Las imágenes se copian desde las fuentes
de marca/medios para que el sitio sea autocontenido:

```
cp assets/brand/quaero-mark.svg          site/assets/
cp assets/brand/quaero-wordmark*.svg     site/assets/
cp assets/media/social-preview.png       site/img/
cp assets/media/screenshot-initial-dark.png site/img/
```

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
`https://danielnuld.github.io/quaero/`.

> Alternativa equivalente: *Source = main, carpeta `/docs`* — no se usa aquí
> porque `/docs` ya contiene la documentación de desarrollo.

## Video demo (#203)

`site/video/quaero-demo.webm` (VP9) + `.mp4` (H.264) + `quaero-demo-poster.png`,
incrustados en la sección de características con `<video autoplay muted loop
playsinline>` y una `<img>` de respaldo dentro del `<video>`. ~23 s, ~330 KB,
alojado en el repo (no en servicios externos).

**Guion (para regrabar en futuras versiones):**
1. **Conectar** — elegir la conexión guardada «Ventas (demo)».
2. **Explorar** — expandir el árbol (base → esquema → Tablas) y abrir una tabla
   (estructura + DDL).
3. **Consultar** — pestaña nueva, escribir un `SELECT … WHERE … ORDER BY` y
   ejecutarlo; se ve la rejilla de resultados tipada.
4. **Herramientas** — Diagrama ER (relaciones entre tablas) y constructor visual.

**Cómo se generó (reproducible, sin datos reales):** un harness de
`puppeteer-core` conduce la **UI real** de `frontend/dist/index.html` en Edge
headless con un `window.quaeroRpc` simulado; sólo existe la conexión de prueba
y se bloquea toda la red. Los subtítulos se inyectan en la página para ir
sincronizados. Se capturan cuadros (~8 fps) y se ensamblan con ffmpeg:

```
ffmpeg -y -framerate 8 -i frames/f%04d.png -c:v libvpx-vp9 -crf 33 -b:v 0 \
  -pix_fmt yuv420p -r 24 quaero-demo.webm
ffmpeg -y -framerate 8 -i frames/f%04d.png -c:v libx264 -crf 24 \
  -pix_fmt yuv420p -r 24 -movflags +faststart quaero-demo.mp4
```

Para una regrabación de máxima fidelidad puede sustituirse por una captura de
pantalla de la app real siguiendo el mismo guion (mismos pasos y datos de demo).

## Pendiente (issues del milestone M10.10)

- **#201** La comparativa ya trae **fuentes + fecha de revisión** por competidor
  (verificable). Falta la **aprobación de copy del propietario** antes de publicar.
- **#202** Sustituir/añadir capturas reales por módulo desde el kit de medios
  (`assets/media/`, ver [MEDIA-KIT](../assets/media/MEDIA-KIT.md)); hoy hay el
  social preview, la pantalla inicial y la galería de módulos.
