# Quaero

> Cliente de bases de datos moderno, ligero y multiplataforma — una alternativa profesional y de código abierto al estilo de Navicat.

[![CI](https://github.com/danielnuld/quaero/actions/workflows/ci.yml/badge.svg)](https://github.com/danielnuld/quaero/actions/workflows/ci.yml)

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

El binario queda en `build/app/quaero` (`.exe` en Windows). La shell abre una ventana nativa que carga el bundle embebido y conecta el frontend con el núcleo vía IPC.

**Dependencias de la shell (webview)** por plataforma:
- **Linux**: `libgtk-4-dev libwebkitgtk-6.0-dev`.
- **macOS**: WebKit del sistema (sin instalar nada).
- **Windows**: WebView2 (se descarga al compilar; runtime ya incluido en Windows 11).

Para compilar solo el núcleo y sus tests sin las dependencias de GUI:

```bash
cmake -S . -B build -G Ninja -DQUAERO_BUILD_APP=OFF
```

### Frontend (UI)

```bash
pnpm --dir frontend install
pnpm --dir frontend dev      # servidor de desarrollo con HMR
pnpm --dir frontend build    # genera frontend/dist/index.html (un solo archivo)
pnpm --dir frontend test     # vitest
```

El build del frontend produce **un único `index.html` autocontenido** (JS/CSS inline) que CMake **incrusta en el binario** (`cmake/EmbedAssets.cmake`) — un solo ejecutable, sin archivos sueltos. Si no se compila el frontend, el build en C usa un placeholder.

### Estructura del repo

```
core/         libdbcore — núcleo en C (sin UI)
drivers/      plugins de motores (se agregan por milestone)
app/          shell nativa (host del webview) + bundle embebido
frontend/     UI web (SolidJS + Vite + TypeScript)
third_party/  dependencias vendorizadas (cJSON)
cmake/        helpers de CMake
```

## Documentación

- [Plan de desarrollo / ROADMAP](ROADMAP.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Contrato de drivers (vtable)](docs/DRIVER_API.md)
- [Cómo escribir un driver](docs/WRITING_A_DRIVER.md)
- [Protocolo IPC núcleo ↔ frontend](docs/IPC.md)
- [Cómo contribuir](CONTRIBUTING.md)

## Licencia

[GPLv3](LICENSE). Los drivers de motores propietarios (Oracle, Informix, etc.) se distribuyen como plugins separados y cargados en tiempo de ejecución para respetar sus licencias.
