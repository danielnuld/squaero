# Kit de medios de Quaero

Material visual para la publicación (README, landing de M10.10, redes). Los
assets de marca base (logo, wordmark, paleta) están en
[`assets/brand/`](../brand/BRAND.md); aquí viven las piezas derivadas para
difusión.

## Tagline

- **ES (principal):** «Consulta cualquier base de datos.»
- **EN (principal):** “Query any database.”
- **Descriptor largo (ES):** «Cliente de bases de datos moderno, ligero y
  multi-motor: MySQL, PostgreSQL, SQLite, Informix y MongoDB.»
- **Descriptor largo (EN):** “Modern, lightweight, multi-engine database client —
  MySQL, PostgreSQL, SQLite, Informix and MongoDB.”

## Inventario

| Archivo | Uso | Estado |
|---|---|---|
| `social-preview.png` (1280×640) | Social preview de GitHub + hero del README/landing. | ✅ Final |
| `social-preview.html` | Fuente editable del banner (self-contained; ver cómo regenerar abajo). | ✅ Fuente |
| `screenshot-initial-dark.png` (1280×800) | Captura oficial de la pantalla inicial (tema oscuro). | ✅ |
| Set curado de capturas con datos (ver checklist) | README/landing. | ⏳ Capturar con datos reales |

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

## Checklist de encuadre para las capturas curadas

Para mantener el set homogéneo entre versiones, capturar **todas** con el mismo
marco:

- **Resolución:** ventana **1280×800**, factor de escala 1, sin barras de
  desplazamiento (`--hide-scrollbars`). Recortar exactamente a la ventana.
- **Temas:** cada pantalla en **oscuro y claro** (alternar con el botón de tema
  de la barra de estado). Mismo estado/datos en ambas.
- **Datos:** usar una base de datos de demo con datos realistas pero neutros
  (p.ej. `shop`: `customers`, `orders`, `products`), nunca datos sensibles.
- **Idioma de la UI:** español (por defecto).
- **Cursor y menús:** sin menús contextuales abiertos ni tooltips a medias,
  salvo que la captura sea específicamente de esa función.

Pantallas a incluir (una por función, oscuro + claro):

1. **Editor + grid** con una consulta ejecutada y resultados (la pantalla estrella).
2. **Diagrama ER** con varias tablas y relaciones.
3. **Constructor visual de consultas** con condiciones y vista previa del SQL.
4. **Monitor de servidor** con la lista de procesos.
5. **Árbol de objetos agrupado** (Tablas/Vistas/Procedimientos…) expandido.

> Las capturas 1–5 requieren datos reales; se toman contra un servidor de demo
> ejecutando la app real (ver [quaero-local-run] / la skill `run`). Nombrarlas
> `screenshot-<pantalla>-<tema>.png` (p.ej. `screenshot-editor-grid-dark.png`).

## GIF/webm del flujo principal (opcional)

Flujo sugerido, 30–60 s: conectar → abrir tabla → ejecutar consulta → editar una
celda → confirmar. Grabar a 1280×800, recortar y exportar a `.webm` (repo-hosted)
para el README/landing.
