# Sitio (landing page) — GitHub Pages

Landing page de Quaero. Sitio **estático puro** (HTML/CSS, sin frameworks, sin
paso de build) para poder publicarse en **GitHub Pages clásico por rama**, sin
depender de GitHub Actions.

## Estructura

```
site/
  index.html      # página única: hero, características, comparativa, descargas
  assets/         # logo + wordmark (SVG, copiados de assets/brand/)
  img/            # social preview + capturas (de assets/media/)
  .nojekyll       # evita el procesado Jekyll (servir los archivos tal cual)
```

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

## Pendiente (issues del milestone M10.10)

- **#201** La comparativa es un **borrador**; requiere verificación y aprobación
  del propietario antes de publicar (cada celda debe ser comprobable). Anotar la
  fecha de revisión en el fuente.
- **#202** Sustituir/añadir capturas reales por módulo desde el kit de medios
  (`assets/media/`, ver [MEDIA-KIT](../assets/media/MEDIA-KIT.md)); hoy solo hay
  el social preview y la pantalla inicial.
- **#203** Grabar el video/GIF demo (30–60 s: conectar → explorar → consultar →
  editar con transacción → exportar) y alojarlo en el repo/release; incrustarlo
  con póster de respaldo.
