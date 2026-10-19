# Iconos de aplicación

Iconos de **Squaero** para las tres plataformas. Los iconos del sistema no pueden
seguir el tema de la app, así que van fijos al **azulejo B · Nativo** (cuadrado
redondeado teal `#0f7b72`, anillo blanco, prompt y cola menta `#a6ebe0`):

- **≥ 48px:** [`quaero-app-icon.svg`](quaero-app-icon.svg) (trazos 14/10).
- **≤ 32px:** [`assets/brand/quaero-mark-solid.svg`](../brand/quaero-mark-solid.svg)
  (mismo azulejo, trazos engrosados 18/14 para que se lea a 16px).

## Archivos

| Archivo | Plataforma | Uso |
|---|---|---|
| `quaero.ico` | Windows | Icono multi-resolución (16, 24, 32, 48, 64, 256). Se **embebe en `squaero.exe`** vía `app/quaero.rc.in` (recurso `1 ICON`), por lo que aparece en el Explorador, la barra de tareas y la ventana del webview. Lo consume también el MSI (M11 #40). |
| `quaero.icns` | macOS | Icono del `.app` (M11 #40). Entradas PNG 16–512. |
| `hicolor/<n>x<n>/apps/quaero.png` | Linux | Tema de iconos hicolor para AppImage/deb (M11 #40). |
| `quaero.desktop` | Linux | Entrada de menú/lanzador (`Icon=quaero`, `StartupWMClass=quaero`). |

El icono de la ventana en runtime en Windows sale del recurso embebido (id `1`),
así que no requiere código; en Linux lo resuelve el `.desktop` + hicolor.

## Regeneración (reproducible desde el SVG)

Desde la raíz del repo, con `pnpm install` hecho en `frontend/`:

```sh
node scripts/render-brand.mjs
```

Rasteriza los SVG con el Chromium de Playwright y llama a
`pack-icons.mjs`, que ensambla los contenedores ICO/ICNS a mano (entradas PNG)
sin ImageMagick ni librerías externas. Para empaquetar PNG propios:
`node pack-icons.mjs <dir con s16.png, s24.png…> assets/icons`. No edites los
binarios a mano: todo sale de los SVG fuente.
