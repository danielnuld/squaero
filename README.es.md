<p align="center">
  <img src="assets/media/social-preview.png" alt="Squaero — gestor de bases de datos ligero, local y libre" width="820">
</p>

<p align="center">
  <em>Cliente de bases de datos moderno, ligero y multi-motor — alternativa de código abierto al estilo de Navicat.</em>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b>
</p>

<p align="center">
  <a href="https://github.com/danielnuld/squaero/releases"><img alt="Release" src="https://img.shields.io/github/v/release/danielnuld/squaero?include_prereleases&sort=semver"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPLv3-blue"></a>
  <img alt="Motores" src="https://img.shields.io/badge/motores-SQLite%20%C2%B7%20PostgreSQL%20%C2%B7%20MySQL%2FMariaDB%20%C2%B7%20Informix%20%C2%B7%20MongoDB%20%C2%B7%20SQL%20Server-0f7b72">
</p>

**Squaero** (del latín *quaero*, «yo busco/indago») es un cliente de bases de datos
multi-motor con un **núcleo en C** (`libdbcore`) y una **interfaz web sobre el
webview nativo del sistema operativo** (WebView2 en Windows, WebKitGTK en Linux,
WKWebView en macOS). Una UI moderna sin el peso de Electron, y un motor nativo que
habla directo con las librerías cliente de cada base de datos.

## Motores soportados

| Motor | Estado |
|---|---|
| **SQLite** | ✅ Completo (verificado) |
| **PostgreSQL** | ✅ Vía libpq — SSL/TLS, SCRAM |
| **MySQL / MariaDB** | ✅ Completo (verificado) — SSL/TLS, túnel SSH |
| **Informix** | ✅ Por DRDA, sin cliente de IBM |
| **MongoDB** | ✅ Sintaxis mongosh — find/aggregate, escrituras (insert/update/replace/delete), índices, `runCommand`; edición de documentos en la cuadrícula por `_id`; la definición de una colección como script; plan de ejecución (`.explain()`), monitor de operaciones (`currentOp`/`killOp`), consultas lentas desde el profiler, gestión de colecciones/vistas/índices desde el árbol, cancelar (`killOp`) y transacciones en un replica set o clúster con shards (un servidor standalone lo dice) |
| **SQL Server** | ✅ Vía FreeTDS — consultas, tipos, esquema, transacciones, cifrado, instancias con nombre, cancelar. Aún no: editar filas en la rejilla, DDL |
| Oracle | ⏳ Planeado (M12) |

Los motores se cargan como **plugins** (`.dll`/`.so`) que implementan un contrato
en C: agregar un motor no requiere tocar el núcleo. Ver
[cómo escribir un driver](docs/WRITING_A_DRIVER.md).

## Funcionalidades

**Editor SQL**
- Editor CodeMirror que entiende la consulta: **autocompletado contextual**
  (alias, CTEs, subconsultas, joins por clave foránea, palabras clave de la
  cláusula), **diagnósticos** (nombres desconocidos, columnas ambiguas, escrituras
  de riesgo), **ir a la definición**, **buscar usos** y **renombrar** en el
  script, **multicursor** y **plantillas** por abreviatura.
- **Formateo** de SQL según el dialecto del motor; ejecutar **selección /
  sentencia / documento**.
- **Historial** de consultas con duración por consulta y marca de lentas, e
  **historial local** del texto de cada pestaña, para recuperar lo que se
  sobrescribió o se cerró.
- **Snippets / favoritos**; **paleta de comandos** (Ctrl/Cmd+K).
- **Plan de ejecución visual** (EXPLAIN) como árbol.

**Ejecución segura**
- **Modo seguro** por conexión: solo lectura (las escrituras se rechazan antes de
  enviarse) o confirmar escrituras.
- **Transacciones manuales** con confirmar/revertir, o auto-commit.
- **Cancelar** una consulta en curso en todos los motores; lo que un motor no
  puede hacer se muestra deshabilitado con el motivo, nunca se finge.
- **Recuperación de la conexión perdida** (reconecta, y reintenta una lectura
  solo cuando es seguro) y **keep-alive** opcional.

**Grid de resultados**
- Virtualizado, **orden y filtro** por columna, **paginación real** (offset).
- **Edición transaccional** en línea (insert/update/delete + preview del SQL +
  commit/rollback); **detalle de fila** (vista formulario).
- **Selección de bloques de celdas** con un **resumen** en la barra de estado
  (conteo, NULLs, suma, promedio, mínimo, máximo) y **vista transpuesta** de los
  resultados anchos.
- **Fijar** un resultado para que la siguiente ejecución no lo reemplace, y
  **comparar** dos resultados.
- **Exportar** CSV / JSON / SQL / XML / HTML / **XLSX**; **importar** CSV / JSON / XLSX.
- **Gráficos** (barras / líneas / pastel).

**Objetos y diseño**
- Árbol lazy y virtualizado **agrupado por tipo** (tablas, vistas, procedimientos,
  funciones, triggers, eventos), servido desde una **caché del esquema** mientras
  se vuelve a leer en segundo plano.
- **Diseñador de tablas** (crear y ALTER), **editor de índices y constraints**.
- **Procedimientos / funciones**, **triggers / eventos**, **usuarios y permisos**.
- **Monitor de servidor** (lista de procesos + kill), **consultas lentas**.
- **Diagrama ER** (llaves foráneas reales del motor) y **constructor visual de consultas**.
- **Buscar un texto** en las tablas de un esquema.

**Datos entre conexiones**
- **Comparación de esquemas** con un **script de migración** revisable y
  ordenado por dependencias; **sincronización** de datos, **transferencia** de
  tablas entre conexiones, **generación de datos** de prueba.
- **Respaldo y restauración**, y el **DDL del esquema a una carpeta**, un `.sql`
  por objeto, listo para versionar en git.

**Conectividad y plataforma**
- **Túnel SSH** (todos los motores), **SSL/TLS** (MySQL, PostgreSQL, MongoDB, Informix, SQL Server),
  **import/export** de conexiones guardadas — y también se leen las de
  **DBeaver** (`data-sources.json`, con su `credentials-config.json` al lado) y
  **Navicat** (`.ncx`), **con contraseñas**, para no reteclear treinta servidores
  al mudarse.
- Cuatro **estilos** incluidos — **B · Nativo** (el predeterminado), **A · Quiet
  pro**, **C · Editorial** y **Rosa pastel**, cada uno claro y oscuro — más los
  temas anteriores y los tuyos, importados desde un archivo. Tipografía, zoom de
  la interfaz y estilo de la rejilla configurables.
- Comportamiento de escritorio: **barra de menús nativa** en Windows y Linux,
  iconos propios, la ventana recuerda su tamaño y posición, **atajos de teclado
  editables** ([lista](docs/SHORTCUTS.md)), menús contextuales adaptativos.
- **Un solo ejecutable** (UI incrustada) + drivers como plugins. Sin Electron.

**Más allá del escritorio**
- **`quaero-mcp`**: un servidor [Model Context Protocol](docs/MCP.md) que expone
  a clientes MCP las conexiones que elijas, en solo lectura salvo que permitas
  escrituras.
- **iPhone**: el mismo núcleo y los mismos drivers con una app SwiftUI —
  explorar, consultar, editar con Face ID y una transacción, exportar — y, en
  los dispositivos con el modelo de Apple en el propio equipo, filtrar una tabla
  preguntando. En preparación para la App Store.

<p align="center">
  <img src="assets/media/screenshot-initial-dark.png" alt="Squaero — pantalla inicial" width="820">
</p>

## Instalación

**Windows:** descarga el instalador `.msi` más reciente desde
[**Releases**](https://github.com/danielnuld/squaero/releases) y ejecútalo. Requiere
el runtime de **WebView2** (ya incluido en Windows 11). Cada release adjunta un
`SHA256SUMS.txt` para verificar la descarga:
`sha256sum -c SHA256SUMS.txt` (o `CertUtil -hashfile squaero-*.msi SHA256`).
Desde la v0.26.0 cada release lleva además una attestation de procedencia
firmada, que demuestra que el MSI lo construyó el workflow de release de este
repositorio: `gh attestation verify squaero-X.Y.Z-x64.msi --repo danielnuld/squaero`.
El MSI aún no lleva firma Authenticode, así que SmartScreen de Windows muestra
un editor desconocido.

**Informix** no necesita ningún cliente de IBM: Squaero habla DRDA con el
servidor mediante [libdrda](https://github.com/danielnuld/libdrda). El servidor
debe tener un listener DRDA (una entrada `drsoctcp` en su `sqlhosts`, normalmente
en el puerto 9089; se comprueba con `onstat -g ntt`). Las conexiones guardadas
de versiones anteriores pasan solas al 9089, y piden revisar el puerto cuando el
suyo no era el 9088.

**Linux:** desde la v0.29.0 cada release adjunta un `.deb` para Ubuntu 24.04+ y
Debian 13+ (x86_64), con su línea en el mismo `SHA256SUMS.txt`:
`sudo apt install ./squaero_X.Y.Z_amd64.deb`. apt instala el cliente de cada
driver. En cualquier
distribución con snapd, instálalo desde la [Snap Store](https://snapcraft.io/squaero):
`sudo snap install squaero`.

**macOS:** desde la v0.32.0 cada release adjunta `squaero-X.Y.Z-arm64.dmg` para
Apple Silicon con macOS 15 o posterior: ábrelo y arrastra Squaero a Aplicaciones.
Va firmado ad hoc, no con un Developer ID de Apple, así que la primera vez macOS lo
bloquea: abre **Ajustes del Sistema → Privacidad y seguridad** y pulsa **Abrir
igualmente** (o ejecuta `xattr -dr com.apple.quarantine /Applications/Squaero.app`).

> AppImage/Flatpak y una build para Mac con Intel no están previstas todavía.

## Compilar desde el código

Requisitos: **CMake ≥ 3.20**, un compilador C11 (GCC/Clang/MSVC) y, recomendado,
**Ninja**; **Node + pnpm** para la UI.

```bash
# UI (genera frontend/dist/index.html, un solo archivo que se incrusta)
pnpm --dir frontend install
pnpm --dir frontend build

# Núcleo + app
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure   # tests del núcleo
```

El binario queda en `build/app/squaero` (`.exe` en Windows). **Dependencias del
webview**: Linux `libgtk-4-dev libwebkitgtk-6.0-dev`; macOS WebKit del sistema;
Windows WebView2 (se descarga al compilar). Para solo el núcleo:
`-DQUAERO_BUILD_APP=OFF`.

**PostgreSQL:** el driver enlaza `libpq`: el del sistema si lo hay; el build de
release de Windows compila un libpq estático desde el código con `-DQUAERO_LIBPQ=ON`.

**MongoDB:** el driver enlaza `libmongoc`. Si no hay una copia del sistema,
compílalo desde el código con `-DQUAERO_MONGOC=ON` (descarga y enlaza
mongo-c-driver estáticamente; TLS con Secure Channel en Windows).

**SQL Server:** el driver enlaza db-lib de FreeTDS, 1.4 o posterior. Si no hay
una (la de Ubuntu 24.04 es más vieja), `-DQUAERO_FREETDS=ON` descarga FreeTDS y
la enlaza estáticamente, como hacen los builds de release.

**Instalador (Windows MSI):** ver [`installer/build-msi.sh`](installer/build-msi.sh)
(WiX v5 vía `dotnet tool`). Los releases se cortan automáticamente al empujar un tag
de versión — ver [docs/VERSIONING.md](docs/VERSIONING.md).

**Smoke por motor:** `scripts/smoke/run.sh <sqlite|mysql|mongodb>` — ver
[docs/QA-SMOKE.md](docs/QA-SMOKE.md).

## Arquitectura

```
Frontend (webview del SO)  ──IPC JSON──>  Núcleo en C (libdbcore)  ──vtable──>  Drivers (plugins)
   UI SolidJS, grid virtual,               conexión, queries,                    sqlite, postgres,
   editor SQL, herramientas                introspección, edición, tx            mysql, informix, mongodb, mssql
```

Detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentación

- [ROADMAP](ROADMAP.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Protocolo IPC](docs/IPC.md)
- [Contrato de drivers](docs/DRIVER_API.md) · [Cómo escribir un driver](docs/WRITING_A_DRIVER.md) · [Modelo de resultados de MongoDB](docs/MONGODB.md) (en inglés)
- [Atajos de teclado](docs/SHORTCUTS.md) · [Glosario de la interfaz](docs/GLOSSARY.md) (en inglés) · [Servidor MCP](docs/MCP.md) (en inglés)
- [Matriz de verificación](docs/QA-MATRIX.md) · [Smoke por motor](docs/QA-SMOKE.md) · [Versionado y releases](docs/VERSIONING.md)
- [Dirección de diseño M14](docs/design/m14/README.md) · [Marca](assets/brand/BRAND.md) · [Sitio web](docs/SITE.md)
- [Cómo contribuir](CONTRIBUTING.md) · [Código de conducta](CODE_OF_CONDUCT.md) · [Inventario de terceros](THIRD-PARTY.md) · [Política de marca](TRADEMARKS.md)

## Licencia

[GPLv3](LICENSE), con un [permiso adicional](LICENSE-EXCEPTION) para distribuirse
por tiendas de apps como la App Store de Apple. El nombre y los logos los cubre la
[política de marca](TRADEMARKS.md): los forks son bienvenidos con nombre propio.
Los drivers de motores propietarios se distribuyen como plugins separados, cargados
en tiempo de ejecución, para respetar sus licencias. Inventario completo de
terceros en [THIRD-PARTY.md](THIRD-PARTY.md).
