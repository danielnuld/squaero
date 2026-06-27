# Quaero

> Cliente de bases de datos moderno, ligero y multiplataforma — una alternativa profesional y de código abierto al estilo de Navicat.

**Quaero** es un cliente de bases de datos multi-motor con un **núcleo en C** y una **interfaz web sobre el webview nativo del sistema operativo** (WebView2 en Windows, WebKitGTK en Linux, WKWebView en macOS). El objetivo es la combinación que distingue a las buenas herramientas: una UI moderna sin el peso de Electron, y un motor nativo que habla directo con las librerías cliente de cada base de datos.

> ⚠️ **Estado: en desarrollo temprano.** Repositorio privado hasta el primer entregable usable. Consulta el [ROADMAP](ROADMAP.md).

## Por qué

- **Moderno pero eficiente** — UI en HTML/CSS/JS renderizada por el webview del SO. Binarios pequeños, sin Chromium embebido.
- **Multi-motor de verdad** — los motores se cargan como **plugins** (`.dll`/`.so`) que implementan un contrato en C. Agregar un motor no requiere tocar el núcleo.
- **Abierto a la comunidad** — los desarrolladores web contribuyen a la UI sin saber C; los de sistemas contribuyen drivers y núcleo sin tocar la UI. Licencia **GPLv3**.

## Arquitectura (resumen)

```
Frontend (webview del SO)  ──IPC JSON──>  Núcleo en C (libdbcore)  ──vtable──>  Drivers (plugins)
   UI moderna, grid                         conexión, queries,                    sqlite, postgres,
   virtualizado, editor SQL                 introspección, transfer               mysql, mongo, ...
```

Detalle completo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Compilar (desarrollo)

Requisitos: **CMake ≥ 3.20**, un compilador C11 (GCC, Clang o MSVC) y, recomendado, **Ninja**.

```bash
# Configurar (build fuera de fuente)
cmake -S . -B build -G Ninja

# Compilar
cmake --build build

# Correr los tests
ctest --test-dir build --output-on-failure
```

El binario placeholder queda en `build/app/quaero` (`.exe` en Windows; la shell con webview llega en el issue #3). La estructura del repo:

```
core/      libdbcore — núcleo en C (sin UI)
drivers/   plugins de motores (se agregan por milestone)
app/       shell nativa (host del webview)
frontend/  UI web (toolchain en #5)
cmake/     helpers de CMake
```

## Documentación

- [Plan de desarrollo / ROADMAP](ROADMAP.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Contrato de drivers (vtable)](docs/DRIVER_API.md)
- [Protocolo IPC núcleo ↔ frontend](docs/IPC.md)
- [Cómo contribuir](CONTRIBUTING.md)

## Licencia

[GPLv3](LICENSE). Los drivers de motores propietarios (Oracle, Informix, etc.) se distribuyen como plugins separados y cargados en tiempo de ejecución para respetar sus licencias.
