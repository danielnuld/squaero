# Arquitectura

Squaero separa estrictamente **núcleo** (lógica, en C) de **interfaz** (presentación, web sobre webview nativo). Esta separación permite testear el núcleo sin abrir ventanas, sustituir el frontend sin reescribir la lógica, y que dos comunidades distintas (sistemas / web) contribuyan en paralelo.

```
┌──────────────────────────────────────────────────────────┐
│  Frontend  —  webview nativo del SO                        │
│  (WebView2 / WebKitGTK / WKWebView)                        │
│   HTML/CSS/JS + framework ligero                           │
│   • gestor de conexiones   • árbol de objetos              │
│   • editor SQL             • grid virtualizado             │
└───────────────────────────▲───────────────────────────────┘
                            │ IPC: JSON-RPC sobre webview_bind
┌───────────────────────────┴───────────────────────────────┐
│  Núcleo en C  —  libdbcore (librería pura, sin UI)         │
│   • gestor de conexiones        • ejecución de queries     │
│   • modelo de result set        • introspección de esquema │
│   • import/export, transfer     • serialización JSON       │
│   • cargador de drivers (dlopen / LoadLibrary)             │
└───────────────────────────▲───────────────────────────────┘
                            │ vtable de driver (driver.h)
┌───────────────────────────┴───────────────────────────────┐
│  Drivers  —  plugins .dll / .so                            │
│   sqlite │ postgres │ mysql │ mongo │ informix │ ...        │
│   cada uno enlaza su librería cliente nativa               │
└────────────────────────────────────────────────────────────┘
```

## Componentes

### Núcleo (`libdbcore`)
Escrito en C11. No tiene ninguna dependencia de UI. Expone una API para:
abrir/cerrar conexiones, ejecutar sentencias, obtener result sets, introspeccionar esquema, y operaciones de alto nivel (transfer, import/export). Serializa todo a JSON para entregarlo al frontend.

### Drivers (plugins)
Cada motor es una biblioteca compartida que implementa la **vtable** definida en [`docs/DRIVER_API.md`](DRIVER_API.md). El núcleo los descubre y carga en tiempo de ejecución. Beneficio clave de licencia: los clientes propietarios (Oracle OCI, Informix CSDK) viven en plugins separados y no se enlazan al núcleo GPL.

### Frontend
Aplicación web empaquetada (assets embebidos en el binario) que corre en el webview del sistema. Se comunica con el núcleo por un único contrato IPC (ver [`docs/IPC.md`](IPC.md)). Cualquier framework web ligero sirve; la UI debe priorizar **virtualización** (no renderizar filas/nodos fuera de viewport) para sostener datasets grandes.

### Shell nativo (`app/`)
Programa C++ que abre la ventana del sistema (WebView2 / WebKitGTK / WKWebView vía la biblioteca `webview`), carga el bundle del frontend y expone el puente `window.quaeroRpc` por el que viaja el IPC. Además enlaza unas pocas funciones globales que **no son IPC** — no llegan al núcleo; son la ventana misma, que solo la UI sabe cómo debe estar — y que el frontend envuelve en `src/utils/` comprobando que existan (en un navegador normal, `pnpm dev`, no están):

| Binding | Envoltorio | Qué hace |
|---|---|---|
| `quaeroOpenExternal(url)` | `openExternal.ts` | Abre una URL http(s) en el navegador del usuario. |
| `quaeroPickFile(title)` → `string \| null` | `pickFile.ts` | Diálogo nativo de abrir archivo; devuelve la ruta absoluta. |
| `quaeroDownloadAndInstall(url)` → `{ok}` | `installUpdate.ts` | Solo Windows: descarga el MSI de una release y lo instala. |
| `quaeroSetTitle(title)` | `shell.ts` | Título de la ventana nativa (`"orders — prod-db — Squaero"`). |
| `quaeroSetTheme("dark" \| "light")` | `shell.ts` | La barra de título sigue el tema resuelto por la UI (DWM en Windows, `gtk-application-prefer-dark-theme` en Linux, `NSAppearance` en macOS). |
| `quaeroSetMenu(json)` → `boolean` | `nativeMenu.ts` | Solo Windows y Linux (#686): la barra de menús nativa, construida a partir del modelo que envía la UI — `[{label, items:[{id, label, accel?, enabled?} \| {separator:true}]}]`, idioma incluido; `[]` la quita (ajuste `nativeMenu`). Cada `id` es un id del catálogo de acciones (atajos / paleta), salvo `quit`, que cierra la ventana desde el shell. Un clic vuelve a la página como `CustomEvent("quaero-menu", {detail: id})` y App lo ejecuta por el mismo camino que la paleta. Los aceleradores solo se muestran (`"Ctrl+Enter"`); las teclas las sigue atendiendo la UI, así que nunca se disparan dos veces. En Windows es un `HMENU` (`WM_COMMAND` en `shell_wndproc`) y no sigue el tema oscuro de la app — no hay API documentada; en Linux `GtkMenuBar` (GTK3) o `GtkPopoverMenuBar` + `GSimpleAction` (GTK4), con el `WebKitWebView` movido a un `GtkBox` bajo la barra. macOS conserva su menú de AppKit (`macos.mm`), que es lo que enruta Cmd+C/V al web view. `app/src/menu_model.c` es el parser puro del modelo (probado en `app/tests/menu_model_test.c`). |

El shell también quita a la ventana lo que la delataría como navegador (#685): teclas de recarga/zoom/impresión/atrás, zoom con Ctrl+rueda, menú contextual nativo, navegación a archivos soltados sobre la ventana (bloqueada en el motor y con `preventDefault` en el frontend, `hostGuards.ts`), DevTools solo en builds Debug; y recuerda tamaño, posición y maximizado de la ventana (`%APPDATA%\Squaero\window`, `~/.config/squaero/window`, y las preferencias de usuario en macOS).

## Principios de diseño

1. **El núcleo nunca importa nada de la UI.** Si una función necesita estado de UI, va en el frontend.
2. **Un solo contrato IPC**, versionado y documentado. Es la frontera de estabilidad entre las dos comunidades.
3. **La vtable del driver es sagrada.** Cambiarla rompe a todos los drivers; se versiona y se evoluciona con cuidado.
4. **Todo dato hacia la UI es JSON.** El frontend no conoce tipos nativos de C ni de la base de datos; recibe un modelo uniforme.
5. **Sin truncamiento silencioso.** Límites (paginación, top-N) son explícitos y comunicados a la UI.
