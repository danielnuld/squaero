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
│   • edición y transacciones     • serialización JSON       │
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
abrir/cerrar conexiones (con el túnel SSH), ejecutar y cancelar sentencias, paginar result sets, introspeccionar esquema, editar filas y llevar transacciones. Serializa todo a JSON para entregarlo al frontend. Import/export, transferencia, sincronización, comparación de esquemas y respaldo **no** están en el núcleo: el frontend los compone sobre esos métodos (ver [`docs/IPC.md`](IPC.md#sin-métodos-para-importexporttransferencia--decisión-m8m9)).

Al abrir una conexión el núcleo informa qué puede hacer su driver (`features`: cancelar, transacciones, DDL, edición, esquemas, introspección), con la misma prueba con la que enruta cada operación, y la UI deshabilita lo ausente en vez de fallar al pulsar (#668). También recuerda por conexión si hay una transacción abierta (rechaza un `tx.begin` anidado) y, cuando una sesión muere bajo una llamada, lo dice con datos para reconectar y saber si reintentar es seguro (#667, #676). Su clasificador de sentencias de solo lectura (`stmt_class`, *fail-closed*) es el que usan el servidor MCP y el agente del iPhone; el modo seguro del frontend replica sus reglas en `safeMode.ts`.

### Drivers (plugins)
Cada motor es una biblioteca compartida que implementa la **vtable** definida en [`docs/DRIVER_API.md`](DRIVER_API.md). El núcleo los descubre y carga en tiempo de ejecución. Beneficio clave de licencia: los clientes propietarios (Oracle OCI; el Client SDK de Informix, que solo usa el respaldo SQLI en Windows y no se incluye) viven en plugins separados y no se enlazan al núcleo GPL. Informix se habla por DRDA con [libdrda](https://github.com/danielnuld/libdrda), sin cliente de IBM.

### Frontend
Aplicación web empaquetada (assets embebidos en el binario) que corre en el webview del sistema. Se comunica con el núcleo por un único contrato IPC (ver [`docs/IPC.md`](IPC.md)). Está escrita en SolidJS + TypeScript; la UI prioriza **virtualización** (no renderizar filas/nodos fuera de viewport) para sostener datasets grandes. La lógica pura vive en `frontend/src/utils/`, con tests.

El estado que solo concierne a la interfaz vive en el frontend, persistido en el almacenamiento del webview, y **no** cambia el protocolo:

- **Conexiones guardadas** (sin contraseñas) y sus ajustes por conexión: **modo seguro** (`safeMode`: solo lectura o confirmar escrituras, #666), aplicado por un único guardia en el cliente IPC (`transport.ts`) antes de enviar nada; y **keep-alive** (#676), una sonda mínima cuando la conexión lleva un rato ociosa.
- **Caché de introspección** (#675, `metaCache.ts`): árbol y columnas por conexión guardada, mostrados «desde caché» mientras se vuelven a leer (*stale-while-revalidate*).
- **Historial local** de cada pestaña del editor (#674, `localHistory.ts`): versiones del texto, ejecutado o no, distinto del historial de consultas.
- **Transacción manual** por conexión (#667, `txMode.ts`) y la reconexión automática tras una caída (`reconnect.ts`), que solo reenvía una llamada cuando el núcleo dice que es seguro.
- **Inteligencia del editor**: el ámbito de cada consulta (alias, CTEs, subconsultas; `sqlScope.ts`) alimenta el autocompletado contextual, los diagnósticos, ir a la definición, buscar usos y renombrar.
- **Temas y estilos** como datos (`themes.ts`, `themeSchema.ts`): los cuatro estilos de M14 y los temas anteriores, con comprobación de contraste.

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
| `quaeroWindow(cmd, ...args)` → `{os, frameless, maximized, backdrop}` | `titleBar.ts` | Solo Windows y macOS (#688): la barra de título propia. `frameless` (bool) cambia entre la barra propia y la del sistema al momento y se recuerda (`%APPDATA%\Squaero\titlebar`, preferencias de usuario en macOS) para abrir ya sin marco; `minimize`, `maximize` (alterna), `close` (pasa por `WM_CLOSE`: se guarda la posición), `drag` y `double-click` (pulsación en el hueco de la barra), `system-menu` (Windows: el menú de ventana bajo el puntero), `snap x y w h` (Windows: dónde está el botón maximizar, en px CSS) y `backdrop` (bool, Windows 11 22H2+: Mica tras la página; la UI solo lo pide con el estilo Nativo y solo deja transparentes la barra y la columna lateral). En Windows `WM_NCCALCSIZE` convierte el título en área cliente y deja los bordes laterales e inferior nativos; dos ventanas hijas sin superficie sobre el web view responden `HTTOP` (franja superior de redimensionado) y `HTMAXBUTTON` (sobre el botón maximizar de la UI, lo que muestra Snap layouts); el shell avisa a la página con `CustomEvent("quaero-window")` (estado al maximizar/restaurar, `{maxHover}`). Sin marco no hay `HMENU`: la UI dibuja el mismo modelo de `quaeroSetMenu` en su barra, con teclas de acceso Alt. En macOS: barra transparente a tamaño completo con los semáforos encima y el menú global de siempre. Linux conserva el marco del sistema (no hay binding) y la UI dibuja su barra debajo, sin botones de ventana. `app/src/titlebar.c` es la parte pura (probada en `app/tests/titlebar_test.c`). |

El shell también quita a la ventana lo que la delataría como navegador (#685): teclas de recarga/zoom/impresión/atrás, zoom con Ctrl+rueda, menú contextual nativo, navegación a archivos soltados sobre la ventana (bloqueada en el motor y con `preventDefault` en el frontend, `hostGuards.ts`), DevTools solo en builds Debug; y recuerda tamaño, posición y maximizado de la ventana (`%APPDATA%\Squaero\window`, `~/.config/squaero/window`, y las preferencias de usuario en macOS).

### Otros clientes del núcleo
El mismo `libdbcore` y los mismos drivers sirven a más de una interfaz:

- **`quaero-mcp`** (`tools/quaero-mcp/`): servidor [Model Context Protocol](MCP.md) por stdio, de solo lectura salvo que la conexión lo permita.
- **`quaero-rpc`** (`tools/`): puente stdio al dispatcher JSON-RPC, que usa la batería de smoke (`scripts/smoke/`, ver [QA-SMOKE](QA-SMOKE.md)).
- **App del iPhone** (`ios/`): iOS no puede cargar plugins, así que con `-DQUAERO_STATIC_DRIVERS=ON` cada driver se enlaza estático y una tabla generada los registra (`drivers/static/`); el núcleo se empaqueta como `SquaeroCore.xcframework` y la interfaz es SwiftUI.

## Principios de diseño

1. **El núcleo nunca importa nada de la UI.** Si una función necesita estado de UI, va en el frontend.
2. **Un solo contrato IPC**, versionado y documentado. Es la frontera de estabilidad entre las dos comunidades.
3. **La vtable del driver es sagrada.** Cambiarla rompe a todos los drivers; se versiona y se evoluciona con cuidado.
4. **Todo dato hacia la UI es JSON.** El frontend no conoce tipos nativos de C ni de la base de datos; recibe un modelo uniforme.
5. **Sin truncamiento silencioso.** Límites (paginación, top-N) son explícitos y comunicados a la UI.
