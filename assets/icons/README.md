# Iconos de aplicación

Iconos de **Quaero** para las tres plataformas, derivados del isotipo de marca
([`assets/brand/quaero-mark-solid.svg`](../brand/quaero-mark-solid.svg)). Se usa
la variante **sólida** (disco índigo con el prompt calado) en todos los tamaños
para que el icono sea consistente y legible incluso a 16px.

## Archivos

| Archivo | Plataforma | Uso |
|---|---|---|
| `quaero.ico` | Windows | Icono multi-resolución (16–256). Se **embebe en `quaero.exe`** vía `app/quaero.rc.in` (recurso `1 ICON`), por lo que aparece en el Explorador, la barra de tareas y la ventana del webview. Lo consume también el MSI (M11 #40). |
| `quaero.icns` | macOS | Icono del `.app` (M11 #40). Entradas PNG 16–512. |
| `hicolor/<n>x<n>/apps/quaero.png` | Linux | Tema de iconos hicolor para AppImage/deb (M11 #40). |
| `quaero.desktop` | Linux | Entrada de menú/lanzador (`Icon=quaero`, `StartupWMClass=quaero`). |

El icono de la ventana en runtime en Windows sale del recurso embebido (id `1`),
así que no requiere código; en Linux lo resuelve el `.desktop` + hicolor.

## Regeneración (reproducible desde el SVG)

1. Rasteriza el isotipo sólido a PNG en cada tamaño. Con cualquier rasterizador,
   p.ej. `rsvg-convert`:

   ```sh
   for s in 16 32 48 64 128 256 512; do
     rsvg-convert -w $s -h $s ../brand/quaero-mark-solid.svg > /tmp/qi/s$s.png
   done
   ```

2. Empaqueta `.ico` + `.icns` + hicolor con el script sin dependencias:

   ```sh
   node pack-icons.mjs /tmp/qi assets/icons
   ```

`pack-icons.mjs` ensambla los contenedores ICO/ICNS a mano (entradas PNG) y no
requiere ImageMagick ni librerías externas. No edites los binarios a mano: todo
sale del SVG fuente.
