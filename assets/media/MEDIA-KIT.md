# Kit de medios de Squaero

Material visual para la publicación (README, landing de M10.10, redes). Los
assets de marca base (logo, wordmark, paleta) están en
[`assets/brand/`](../brand/BRAND.md); aquí viven las piezas derivadas para
difusión.

## Tagline

- **ES (principal):** «Tu gestor de bases de datos: ligero, local y libre.»
- **ES (corta):** «Ligero, local y libre.»
- **EN (principal):** “Your lightweight, local, open-source database client.”
- **EN (corta):** “Lightweight. Local. Open source.”
- **Descriptor largo (ES):** «Gestor de bases de datos nativo y ligero, local y de
  código abierto: SQLite, MySQL/MariaDB, Informix y MongoDB, con edición
  transaccional segura.»
- **Descriptor largo (EN):** “Native, lightweight, local and open-source database
  manager — SQLite, MySQL/MariaDB, Informix and MongoDB, with safe transactional
  editing.”

## Inventario

| Archivo | Uso | Estado |
|---|---|---|
| `social-preview.png` (1280×640) | Social preview de GitHub + hero del README/landing. | ✅ Final |
| `screenshot-main-{nativo,quiet,editorial,rosa}.png` (1360×860) | La ventana de trabajo (árbol + editor + resultado) en cada estilo de M14. README (B claro, A oscuro). | ✅ |
| `screenshot-*.png` restantes (1360×860) | Una por sección del manual (editor, modo seguro, transacción, datos, herramientas, comparar esquemas…). Datos de demostración. | ✅ |
| `social-preview.html` | Fuente editable del banner (self-contained; ver cómo regenerar abajo). | ✅ Fuente |

## Configurar el social preview en GitHub

La imagen OpenGraph del repo **no** se puede subir por API/CLI; es un ajuste
manual una sola vez:

1. GitHub → repositorio → **Settings** → sección **Social preview**.
2. **Edit → Upload an image** → `assets/media/social-preview.png`.
3. Guardar. Verificar compartiendo la URL del repo (la tarjeta debe mostrar el
   banner índigo con el wordmark y la tagline).

## Regenerar el banner

`social-preview.html` es autocontenido (estilos e isotipo inline). Rasterízalo a
exactamente 1280×640, factor de escala 1:

```sh
msedge --headless --disable-gpu --force-device-scale-factor=1 \
  --window-size=1280,640 --screenshot=social-preview.png social-preview.html
```

(Sirve cualquier navegador headless o rasterizador HTML equivalente.)

## Capturas de la app

No se toman a mano: `cd frontend && pnpm media` las regenera todas contra la base
de demostración (`e2e/support/demo.ts`), en español, a 1360×860 y escala 1, y
escribe sus copias AVIF/WebP en `site/img/`. El detalle está en
[`frontend/e2e/README.md`](../../frontend/e2e/README.md#media-capture).

## GIF/webm del flujo principal (opcional)

Flujo sugerido, 30–60 s: conectar → abrir tabla → ejecutar consulta → editar una
celda → confirmar. Grabar a 1280×800, recortar y exportar a `.webm` (repo-hosted)
para el README/landing.
