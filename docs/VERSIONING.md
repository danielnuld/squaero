# Versionado

Squaero tiene **una sola fuente de verdad** para la versión del producto: el
archivo [`VERSION`](../VERSION) en la raíz del repositorio (formato SemVer,
`MAJOR.MINOR.PATCH`, sin prefijo `v`).

## Quién consume la versión

De ese único archivo salen todas las demás:

| Consumidor | Cómo la lee |
|---|---|
| **CMake** (`project(quaero VERSION …)`) | `file(STRINGS VERSION QUAERO_VERSION)` antes de `project()`. Expone `PROJECT_VERSION[_MAJOR/_MINOR/_PATCH]`. |
| **Recurso VERSIONINFO de Windows** (`squaero.exe`) | `app/quaero.rc.in` → `configure_file(@ONLY)` con la versión de `project()`. Propiedades del .exe: ProductName, FileDescription, CompanyName, ProductVersion, FileVersion, Copyright. |
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
se dispara al empujar un tag `vX.Y.Z`. El job `windows-msi` corre en un runner
`windows-latest`:

1. Verifica que el tag coincida con `VERSION` (falla si no).
2. Instala el MinGW x86_64 (winlibs), compila el frontend y hace el build **x64**
   completo con la app y todos los drivers (SSH, MariaDB, mongo-c, libpq, FreeTDS
   y OpenSSL desde fuente). Hasta #560 era x86, porque lo exigía el cliente de
   Informix de 32 bits (eliminado en #557); el x86 aún compila
   (`installer/build-msi.sh <v> x86`), pero no se publica.
3. Construye el MSI con WiX (`installer/build-msi.sh`).
4. Genera `SHA256SUMS.txt`.
5. Emite una **attestation de procedencia** del MSI (`actions/attest-build-provenance`).
6. Publica el release de GitHub adjuntando `squaero-X.Y.Z-x64.msi` +
   `SHA256SUMS.txt` (o los sube a un release ya existente con `--clobber`).

Después, en este orden para no pisarse en `SHA256SUMS.txt`, los demás jobs
añaden al mismo release sus artefactos (cada uno con su attestation y su línea en
`SHA256SUMS.txt`): `linux-deb` (`squaero_X.Y.Z_amd64.deb`, Ubuntu 24.04),
`linux-snap` (el snap, que además se publica en la Snap Store cuando existe el
secret `SNAPCRAFT_STORE_CREDENTIALS`) y `macos-dmg` / `macos-publish`
(`squaero-X.Y.Z-arm64.dmg`, construido por [`macos.yml`](../.github/workflows/macos.yml)).

Flujo típico: bumpea `VERSION`, mergea a `main` con CI en verde, y entonces:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z
```

También se puede relanzar para un tag existente desde **Actions → Release →
Run workflow** (input `tag`).

### Firma

**Procedencia (activa).** Cada MSI lleva una attestation de procedencia: una
firma de Sigstore, emitida al workflow mediante el token OIDC de GitHub, sobre el
digest del MSI. Demuestra que ese archivo exacto salió de `release.yml`, de este
repositorio y de ese tag. Se comprueba con:

```sh
gh attestation verify squaero-X.Y.Z-x64.msi --repo danielnuld/squaero
```

**Authenticode (no).** El MSI no lleva firma Authenticode, así que SmartScreen
muestra «editor desconocido». Desde 2023 las CA solo emiten certificados de firma
de código con la clave en un HSM, así que un `.pfx` en un secret ya no es un
camino. SignPath Foundation rechazó la solicitud (2026-09-16) por poca visibilidad
pública del proyecto; se puede volver a pedir cuando tenga más adopción.

## Nombre del producto y ejecutable

- **Nombre de producto:** `Squaero`.
- **Ejecutable:** `squaero` (`squaero.exe` en Windows, `Squaero.app` en macOS).
  El target de CMake conserva el nombre `quaero` (`add_executable(quaero …)` con
  `OUTPUT_NAME squaero`, #466); el servidor MCP es el binario aparte `quaero-mcp`.
- **Título de la ventana:** `Squaero` al arrancar (fijado por el shell nativo en
  `main.cc`). La UI lo ajusta después a lo que hay en pantalla:
  `<pestaña> — <conexión> — Squaero`, omitiendo la parte que falte
  (`frontend/src/utils/shell.ts`).
