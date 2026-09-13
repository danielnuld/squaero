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
se dispara al empujar un tag `vX.Y.Z` y hace todo en un runner `windows-latest`:

1. Verifica que el tag coincida con `VERSION` (falla si no).
2. Instala el MinGW i686 (winlibs), compila el frontend y hace el build **x86**
   completo con la app y todos los drivers (SSH, MariaDB, mongo-c, libpq desde
   fuente) — el mismo x86 que exige el ODBC de Informix (32-bit).
3. Construye el MSI con WiX (`installer/build-msi.sh`).
4. Genera `SHA256SUMS.txt`.
5. Emite una **attestation de procedencia** del MSI (`actions/attest-build-provenance`).
6. Publica el release de GitHub adjuntando `squaero-X.Y.Z-x86.msi` +
   `SHA256SUMS.txt` (o los sube a un release ya existente con `--clobber`).

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
gh attestation verify squaero-X.Y.Z-x86.msi --repo danielnuld/squaero
```

**Authenticode (en preparación, con SignPath Foundation).** Sin él, SmartScreen
muestra «editor desconocido». Desde 2023 las CA solo emiten certificados de firma
de código con la clave en un HSM, así que un `.pfx` en un secret ya no es un
camino. SignPath Foundation firma gratis proyectos open source, y desde #506 el
MSI ya cumple su condición principal: no contiene componentes propietarios.

Lo que ya está en el repositorio:

- La página **«Code signing policy»** que exige SignPath, en
  <https://danielnuld.github.io/squaero/code-signing-policy/> (`site/code-signing-policy/`),
  enlazada desde el pie de la web. Incluye la atribución, los roles, qué se firma
  y la política de privacidad (la comprobación de actualizaciones contacta con
  GitHub al arrancar).
- Los pasos de firma en `release.yml`, que **no se ejecutan** mientras no exista
  la variable `SIGNPATH_ORGANIZATION_ID`. Suben el MSI como artefacto del
  workflow, lo envían con `signpath/github-action-submit-signing-request@v2`,
  comprueban en el runner que la firma sea `Valid` y lo sustituyen antes de la
  checksum, la attestation y la publicación.

Lo que solo puede hacer el mantenedor, en este orden:

1. Activar **MFA** en GitHub (y luego en SignPath): lo exigen a todo el equipo.
2. Publicar la web con la página de la política (`bash site/publish.sh`).
3. Solicitar la suscripción en <https://signpath.org/apply> (repositorio, licencia
   GPL-3.0, página de la política, artefacto: el MSI del workflow de release).
4. Una vez aprobado, en SignPath: añadir el *Trusted Build System* «GitHub.com» y
   vincularlo al proyecto, e instalar la *SignPath GitHub App* en el repositorio.
   La configuración de artefacto firma el MSI directamente, porque el workflow lo
   sube con `archive: false`. Revisar el esquema en la documentación de SignPath
   al crearla:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <msi-file>
       <authenticode-sign />
     </msi-file>
   </artifact-configuration>
   ```

5. En GitHub (*Settings → Secrets and variables → Actions*): las variables
   `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` y `SIGNPATH_POLICY_SLUG`,
   y el secret `SIGNPATH_API_TOKEN`. La siguiente release saldrá firmada, y la
   primera firma conviene revisarla a mano (*Propiedades → Firmas digitales*).

## Nombre del producto y ejecutable

- **Nombre de producto:** `Squaero`.
- **Ejecutable:** `quaero` (`squaero.exe` en Windows) — coincide con el target de
  CMake `add_executable(quaero …)`.
- **Título de la ventana:** `Squaero` (fijado por el shell nativo en `main.cc`).
  La UI ajusta además el título del documento a `Squaero — <conexión activa>`
  cuando hay una conexión abierta, y a `Squaero` cuando no.
