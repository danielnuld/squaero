# Versionado

Quaero tiene **una sola fuente de verdad** para la versión del producto: el
archivo [`VERSION`](../VERSION) en la raíz del repositorio (formato SemVer,
`MAJOR.MINOR.PATCH`, sin prefijo `v`).

## Quién consume la versión

De ese único archivo salen todas las demás:

| Consumidor | Cómo la lee |
|---|---|
| **CMake** (`project(quaero VERSION …)`) | `file(STRINGS VERSION QUAERO_VERSION)` antes de `project()`. Expone `PROJECT_VERSION[_MAJOR/_MINOR/_PATCH]`. |
| **Recurso VERSIONINFO de Windows** (`quaero.exe`) | `app/quaero.rc.in` → `configure_file(@ONLY)` con la versión de `project()`. Propiedades del .exe: ProductName, FileDescription, CompanyName, ProductVersion, FileVersion, Copyright. |
| **Panel «Acerca de» (UI)** | `frontend/vite.config.ts` lee `../VERSION` y lo inyecta como `__APP_VERSION__`; `utils/version.ts` lo expone como `APP_VERSION` (issue #181). |
| **Tag de release** | El tag debe coincidir: `vX.Y.Z` donde `X.Y.Z` == contenido de `VERSION`. |

> La versión del **núcleo** y la del **protocolo IPC** son independientes y se
> leen en vivo del handshake `app.hello` (ver [IPC.md](./IPC.md)); no se derivan
> de este archivo.

## Cómo bumpear la versión

1. Edita `VERSION` (ej. `0.0.1` → `0.1.0`).
2. Mantén `frontend/package.json` `"version"` en sincronía (solo lo usan
   npm/pnpm y herramientas; no alimenta la versión mostrada, pero conviene que
   coincida para evitar confusión).
3. Reconstruye: `pnpm build` (UI) y el build de CMake (embebe el bundle y, en
   Windows, el VERSIONINFO regenerado).
4. Al publicar, crea el tag `vX.Y.Z` con el mismo valor.

No hay ningún otro lugar donde escribir la versión a mano.

## Nombre del producto y ejecutable

- **Nombre de producto:** `Quaero`.
- **Ejecutable:** `quaero` (`quaero.exe` en Windows) — coincide con el target de
  CMake `add_executable(quaero …)`.
- **Título de la ventana:** `Quaero` (fijado por el shell nativo en `main.cc`).
  La UI ajusta además el título del documento a `Quaero — <conexión activa>`
  cuando hay una conexión abierta, y a `Quaero` cuando no.
