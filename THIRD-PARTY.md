# Dependencias de terceros y licencias

Squaero se publica bajo [**GPLv3**](LICENSE). Este documento inventaría todo el
software de terceros que entra en una compilación de Squaero, su licencia, cómo se
enlaza y en qué artefacto se distribuye, y confirma la compatibilidad con la
GPLv3 y la separación de los clientes de base de datos **propietarios**.

> Auditoría de cara al lanzamiento (issue #44). Las versiones son las fijadas por
> el árbol de fuentes; las librerías cliente de motor y el webview del sistema se
> resuelven en tiempo de compilación/paquete y pueden variar por plataforma —
> vuelve a verificar la versión y licencia exactas al construir cada instalador.

## Cómo llega cada dependencia a un build

Squaero incorpora terceros por cuatro vías distintas, y eso determina la
obligación de licencia:

1. **Vendorizadas** (`third_party/`): código incluido en el repositorio y
   compilado dentro del binario.
2. **Descargadas al compilar** (`FetchContent`): se clonan y compilan como parte
   del build.
3. **Librerías cliente del motor** (enlace dinámico): se enlazan solo en el
   plugin de driver correspondiente, cuando están presentes en la máquina de
   compilación. El **cliente propietario** (IBM Informix) ni siquiera se enlaza:
   se carga en runtime a través de un administrador de controladores.
4. **Frontend** (npm): se empaquetan minificadas dentro del bundle HTML embebido.
   Las herramientas de desarrollo (Vite, Vitest, TypeScript) **no** se
   distribuyen.

## Inventario

### Núcleo y aplicación (C/C++)

| Componente | Versión | Licencia | Vía | Se distribuye en |
|---|---|---|---|---|
| [cJSON](https://github.com/DaveGamble/cJSON) | 1.7.18 | MIT | Vendorizada (`third_party/cjson`) | Núcleo + app (interno; no expuesto por ningún header público) |
| [SQLite](https://sqlite.org) | 3.46.1 | Dominio público | Vendorizada (`third_party/sqlite`) | Plugin `sqlite` |
| [webview](https://github.com/webview/webview) | 0.12.0 | MIT | FetchContent | App (shell) |
| [libssh2](https://libssh2.org) | 1.11.1 | BSD-3-Clause | FetchContent (**solo con `QUAERO_SSH=ON`**) | Núcleo, si se activa el túnel SSH |

### Webview del sistema (backend de la ventana)

El wrapper `webview` (MIT) no trae motor de render; usa el del sistema operativo:

| Plataforma | Componente | Licencia | Nota |
|---|---|---|---|
| Windows | [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) | Propietario (redistribuible de Microsoft) | Componente del sistema; se instala/actualiza por separado. No se enlaza estáticamente. |
| Linux | WebKitGTK + GTK | LGPL-2.1+ | Librerías del sistema, enlace dinámico. |
| macOS | WKWebView (WebKit) | Sistema (APSL/LGPL) | Framework del sistema. |

### Criptografía del túnel SSH (solo con `QUAERO_SSH=ON`)

| Plataforma | Componente | Licencia |
|---|---|---|
| Windows | WinCNG (Windows CNG) | Sistema (Windows) |
| Otras | OpenSSL 3.x | Apache-2.0 |

### TLS de los drivers en el build x86 (`QUAERO_MARIADB` / `QUAERO_LIBPQ`)

El instalador x86 compila OpenSSL desde su código fuente (`cmake/QuaeroOpenSSL.cmake`,
#144) y lo enlaza **estáticamente** dentro de `mysql.dll` y `postgres.dll`; no se
distribuye ninguna DLL de OpenSSL aparte.

| Componente | Versión | Licencia | Enlace |
|---|---|---|---|
| OpenSSL | 3.0.22 | Apache-2.0 | Estático en los plugins `mysql`, `postgres` y `mssql` (x86) |
| FreeTDS (db-lib) | 1.5.19 | LGPL-2.0-or-later | Estático en el plugin `mssql` (x86, `cmake/QuaeroFreeTDS.cmake`); donde haya una FreeTDS 1.4+ del sistema, dinámico contra ella |

### Librerías cliente de los drivers (enlace dinámico, opcional)

Cada plugin de driver enlaza la librería cliente de su motor **solo si está
presente al compilar**; el driver es un módulo cargado en runtime, separado del
núcleo GPL.

| Driver | Librería cliente | Licencia | Enlace |
|---|---|---|---|
| `mysql` | MariaDB Connector/C | LGPL-2.1 | Dinámico |
| `mongodb` | mongo-c-driver (libmongoc/libbson) | Apache-2.0 | Dinámico |
| `informix` | [libdrda](https://github.com/danielnuld/libdrda) (cliente DRDA) | Apache-2.0 | Estático |
| `informix` | OpenSSL (TLS de libdrda) | Apache-2.0 | Estático (Windows x86) / dinámico (Linux) |

### Frontend (empaquetado en el bundle)

| Componente | Licencia |
|---|---|
| [solid-js](https://www.solidjs.com) | MIT |
| [@codemirror/*](https://codemirror.net) (state, view, commands, language, lang-sql, autocomplete) | MIT |
| [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
| [Lucide](https://lucide.dev) — iconos de la barra de acciones, trazados en `src/components/icons.tsx` (no se enlaza el paquete) | ISC |

Herramientas de desarrollo **no distribuidas** (dev-dependencies): Vite,
vite-plugin-solid, vite-plugin-singlefile, Vitest, TypeScript, jsdom — todas
MIT/ISC, usadas solo para construir y probar.

### App de iPhone (App Store, issue #579)

Todo lo que el build de iOS enlaza **estáticamente** en `SquaeroCore.xcframework`
o empaqueta en la app, con el archivo del texto de licencia que la pantalla
Ajustes › Licencias muestra. La pantalla se genera desde esta tabla
(`node scripts/ios/licenses.mjs`); el job `ios-app` falla si la tabla y
`ios/Squaero/Resources/Licenses.json` no coinciden, y el job `ios-core` falla si el
`xcframework` enlaza algo que la tabla no lista, deja de enlazar algo que lista, o
lleva código GPL/LGPL de otros autores (`scripts/ios/check-inventory.mjs`). El driver `mysql`
va en iOS sobre libmywire, nuestro cliente Apache-2.0 (#583), y `mssql` no entra hasta tener el
suyo (#584): ni MariaDB Connector/C ni FreeTDS (LGPL) están en la app.

Ninguno de los componentes Apache-2.0 publica un archivo `NOTICE` en la versión
fijada (OpenSSL 3.0.22, mongo-c-driver 1.30.1, libdrda 0.2.2, libmywire 0.1.0); mongo-c-driver sí
trae `THIRD_PARTY_NOTICES`, que se muestra completo.

<!-- ios-licenses:start -->
| Componente | Versión | Licencia | Texto |
|---|---|---|---|
| Squaero | — | GPL-3.0 | `LICENSE` |
| cJSON | 1.7.18 | MIT | `ios/Licenses/cjson-LICENSE.txt` |
| SQLite | 3.46.1 | Dominio público | `ios/Licenses/sqlite-PUBLIC-DOMAIN.txt` |
| libpq (PostgreSQL) | 16.9 | PostgreSQL | `ios/Licenses/postgresql-COPYRIGHT.txt` |
| mongo-c-driver (libmongoc, libbson) | 1.30.1 | Apache-2.0 | `ios/Licenses/mongo-c-COPYING.txt`, `ios/Licenses/mongo-c-THIRD_PARTY_NOTICES.txt` |
| libdrda | 0.2.2 | Apache-2.0 | `ios/Licenses/libdrda-LICENSE.txt` |
| libmywire | 0.1.0 | Apache-2.0 | `ios/Licenses/libmywire-LICENSE.txt` |
| OpenSSL | 3.0.22 | Apache-2.0 | `ios/Licenses/openssl-LICENSE.txt` |
| libssh2 | 1.11.1 | BSD-3-Clause | `ios/Licenses/libssh2-COPYING.txt` |
| fflate | 0.8.3 | MIT | `ios/Licenses/fflate-LICENSE.txt` |
| Schibsted Grotesk | — | OFL-1.1 | `ios/Squaero/Resources/Fonts/OFL-SchibstedGrotesk.txt` |
| Martian Mono | — | OFL-1.1 | `ios/Squaero/Resources/Fonts/OFL-MartianMono.txt` |
<!-- ios-licenses:end -->

## Compatibilidad con GPLv3

Todas las licencias del inventario son compatibles con la GPLv3:

- **MIT**, **BSD-3-Clause**, **dominio público** — permisivas; compatibles sin
  condiciones adicionales más allá de conservar el aviso de copyright.
- **Apache-2.0** (mongo-c-driver, OpenSSL 3.x) — compatible con **GPLv3** (no con
  GPLv2). Exige conservar los avisos y el archivo `NOTICE` upstream si existe
  (ver abajo).
- **LGPL-2.1+** (MariaDB Connector/C, unixODBC, WebKitGTK/GTK) — compatible; el
  enlace dinámico preserva la posibilidad de sustituir la librería, como pide la
  LGPL.
- **WebView2 / WKWebView** — componentes del **sistema operativo**. Enlazar contra
  la librería de sistema del SO está cubierto por la *system library exception*
  de la GPL; no se redistribuye el runtime propietario dentro de Squaero.

**Sin conflictos** para distribuir Squaero (núcleo + app + drivers de motores de
licencia abierta) bajo GPLv3.

## Separación de los drivers propietarios

Este es el punto crítico de la arquitectura y la razón de que el sistema de
drivers sea de carga dinámica:

- El **núcleo** (`libdbcore`, GPLv3) no enlaza ninguna librería cliente de motor.
  Solo define la ABI de la vtable ([`docs/DRIVER_API.md`](docs/DRIVER_API.md)).
- Cada **driver** es una biblioteca compartida independiente que el núcleo carga
  en runtime (`dlopen`/`LoadLibrary`). Un driver depende únicamente de la ABI,
  nunca del código del núcleo.
- El driver de **Informix** habla DRDA con **libdrda** (Apache-2.0, compatible
  con la GPLv3), enlazada estáticamente en el plugin (issue #557). DRDA es un
  protocolo abierto (especificación de The Open Group): **ningún componente de
  IBM** se enlaza, se distribuye ni se necesita en el equipo del usuario.
- Los drivers de clientes propietarios (Informix hoy; Oracle en el futuro, M12)
  se **distribuyen por separado** del paquete GPL y se cargan en runtime — nunca
  se enlazan al núcleo GPL ni se incluyen en el instalador principal.

Resultado: la obra combinada que se distribuye bajo GPLv3 no contiene ni enlaza
código propietario. La interoperabilidad con un cliente propietario ocurre en la
máquina del usuario, a través de una frontera de proceso/carga dinámica.

## Obligaciones de aviso (NOTICE)

- **Apache-2.0** (mongo-c-driver, OpenSSL): al redistribuir un binario que
  incluya estos componentes, hay que conservar su aviso de copyright y su archivo
  `NOTICE` si el upstream lo provee. Como se enlazan dinámicamente y solo en
  builds con esos drivers/túnel, el instalador que los incluya debe adjuntar el
  `NOTICE` correspondiente.
- **MIT / BSD**: conservar el texto de copyright y licencia. Los archivos de
  licencia vendorizados ya viven junto a su código (`third_party/cjson/LICENSE`,
  `third_party/sqlite/README.md`).
- **LGPL**: informar que el componente es LGPL y que se enlaza dinámicamente
  (sustituible). No aplica al núcleo, solo a los plugins que enlazan esas libs.

## Checklist de auditoría (#44)

- [x] **Inventario de dependencias y licencias** — este documento.
- [x] **Separación de drivers propietarios confirmada** — carga dinámica; Informix
  ya no usa el CSDK de IBM (DRDA con libdrda, #557); drivers propietarios se
  distribuyen aparte.
- [x] **NOTICE / THIRD-PARTY** — este archivo; las obligaciones Apache-2.0 se
  recogen al empaquetar cada instalador (issue #40) que incluya esos componentes.

## Al empaquetar cada instalador (recordatorio para #40)

Incluye junto al binario el texto de licencia de cada componente **realmente
enlazado en ese artefacto**:

- Siempre: GPLv3 (Squaero), MIT (cJSON, webview, solid-js, CodeMirror), ISC (Lucide).
- Si trae el driver `sqlite`: aviso de dominio público de SQLite.
- Si trae el driver `mysql`: LGPL-2.1 de MariaDB Connector/C.
- Si trae el driver `mongodb`: Apache-2.0 + `NOTICE` de mongo-c-driver.
- Si se compiló con `QUAERO_SSH`: BSD-3-Clause de libssh2 (+ Apache-2.0/`NOTICE`
  de OpenSSL donde aplique).
- Si es el instalador x86: Apache-2.0 de OpenSSL 3.0 (va enlazado dentro de los
  plugins `mysql`, `postgres` y `mssql`) y LGPL de FreeTDS (dentro de `mssql`).
  Al ir estático, la LGPL pide ofrecer lo necesario para re-enlazar el plugin con
  otra FreeTDS: el código del plugin es público y `cmake/QuaeroFreeTDS.cmake` lo
  reconstruye.
