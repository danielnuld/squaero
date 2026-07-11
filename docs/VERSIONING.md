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

## Publicar un release (automatizado)

El release lo produce un tag. El workflow
[`.github/workflows/release.yml`](../.github/workflows/release.yml) (issue #41)
se dispara al empujar un tag `vX.Y.Z` y hace todo en un runner `windows-latest`:

1. Verifica que el tag coincida con `VERSION` (falla si no).
2. Instala el MinGW i686 (winlibs), compila el frontend y hace el build **x86**
   completo con la app y todos los drivers (SSH, MariaDB, mongo-c, libpq desde
   fuente) — el mismo x86 que exige el ODBC de Informix (32-bit).
3. Construye el MSI con WiX (`installer/build-msi.sh`).
4. Genera `SHA256SUMS.txt`.
5. Publica el release de GitHub adjuntando `quaero-X.Y.Z-x86.msi` +
   `SHA256SUMS.txt` (o los sube a un release ya existente con `--clobber`).

Flujo típico: bumpea `VERSION`, mergea a `main` con CI en verde, y entonces:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z
```

También se puede relanzar para un tag existente desde **Actions → Release →
Run workflow** (input `tag`).

### Firma

El MSI se publica **sin firmar**, junto al `SHA256SUMS.txt` para verificar
integridad. Cuando exista un certificado Authenticode, se descomenta el paso
«Sign the MSI» del workflow y se añaden los secrets `WINDOWS_PFX_BASE64` y
`WINDOWS_PFX_PASSWORD` (issue #41, «firma donde aplique»).

## Nombre del producto y ejecutable

- **Nombre de producto:** `Quaero`.
- **Ejecutable:** `quaero` (`quaero.exe` en Windows) — coincide con el target de
  CMake `add_executable(quaero …)`.
- **Título de la ventana:** `Quaero` (fijado por el shell nativo en `main.cc`).
  La UI ajusta además el título del documento a `Quaero — <conexión activa>`
  cuando hay una conexión abierta, y a `Quaero` cuando no.
