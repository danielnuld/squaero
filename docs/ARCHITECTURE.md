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

## Principios de diseño

1. **El núcleo nunca importa nada de la UI.** Si una función necesita estado de UI, va en el frontend.
2. **Un solo contrato IPC**, versionado y documentado. Es la frontera de estabilidad entre las dos comunidades.
3. **La vtable del driver es sagrada.** Cambiarla rompe a todos los drivers; se versiona y se evoluciona con cuidado.
4. **Todo dato hacia la UI es JSON.** El frontend no conoce tipos nativos de C ni de la base de datos; recibe un modelo uniforme.
5. **Sin truncamiento silencioso.** Límites (paginación, top-N) son explícitos y comunicados a la UI.
