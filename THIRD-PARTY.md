# Dependencias de terceros y licencias

Quaero se publica bajo [**GPLv3**](LICENSE). Este documento inventaría todo el
software de terceros que entra en una compilación de Quaero, su licencia, cómo se
enlaza y en qué artefacto se distribuye, y confirma la compatibilidad con la
GPLv3 y la separación de los clientes de base de datos **propietarios**.

> Auditoría de cara al lanzamiento (issue #44). Las versiones son las fijadas por
> el árbol de fuentes; las librerías cliente de motor y el webview del sistema se
> resuelven en tiempo de compilación/paquete y pueden variar por plataforma —
> vuelve a verificar la versión y licencia exactas al construir cada instalador.

## Cómo llega cada dependencia a un build

Quaero incorpora terceros por cuatro vías distintas, y eso determina la
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

### Librerías cliente de los drivers (enlace dinámico, opcional)

Cada plugin de driver enlaza la librería cliente de su motor **solo si está
presente al compilar**; el driver es un módulo cargado en runtime, separado del
núcleo GPL.

| Driver | Librería cliente | Licencia | Enlace |
|---|---|---|---|
| `mysql` | MariaDB Connector/C | LGPL-2.1 | Dinámico |
| `mongodb` | mongo-c-driver (libmongoc/libbson) | Apache-2.0 | Dinámico |
| `informix` | Administrador ODBC: unixODBC (Linux) / `odbc32` (Windows) | LGPL-2.1 / sistema | Dinámico |
| `informix` | **IBM Informix CSDK (ODBC Driver)** | **Propietario (IBM)** | **No enlazado** — se selecciona en runtime vía el administrador ODBC |

### Frontend (empaquetado en el bundle)

| Componente | Licencia |
|---|---|
| [solid-js](https://www.solidjs.com) | MIT |
| [@codemirror/*](https://codemirror.net) (state, view, commands, language, lang-sql, autocomplete) | MIT |

Herramientas de desarrollo **no distribuidas** (dev-dependencies): Vite,
vite-plugin-solid, vite-plugin-singlefile, Vitest, TypeScript, jsdom — todas
MIT/ISC, usadas solo para construir y probar.

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
  de la GPL; no se redistribuye el runtime propietario dentro de Quaero.

**Sin conflictos** para distribuir Quaero (núcleo + app + drivers de motores de
licencia abierta) bajo GPLv3.

## Separación de los drivers propietarios

Este es el punto crítico de la arquitectura y la razón de que el sistema de
drivers sea de carga dinámica:

- El **núcleo** (`libdbcore`, GPLv3) no enlaza ninguna librería cliente de motor.
  Solo define la ABI de la vtable ([`docs/DRIVER_API.md`](docs/DRIVER_API.md)).
- Cada **driver** es una biblioteca compartida independiente que el núcleo carga
  en runtime (`dlopen`/`LoadLibrary`). Un driver depende únicamente de la ABI,
  nunca del código del núcleo.
- El driver de **Informix** enlaza solo el **administrador de controladores ODBC**
  (unixODBC / `odbc32`), que es de licencia abierta / del sistema. La librería
  **propietaria de IBM** (Informix CSDK) **no se enlaza**: el administrador ODBC
  la selecciona en tiempo de ejecución por su nombre registrado. El usuario final
  instala el CSDK de IBM por su cuenta, bajo su propia licencia con IBM.
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
- [x] **Separación de drivers propietarios confirmada** — carga dinámica; el CSDK
  de IBM no se enlaza (se resuelve vía ODBC en runtime); drivers propietarios se
  distribuyen aparte.
- [x] **NOTICE / THIRD-PARTY** — este archivo; las obligaciones Apache-2.0 se
  recogen al empaquetar cada instalador (issue #40) que incluya esos componentes.

## Al empaquetar cada instalador (recordatorio para #40)

Incluye junto al binario el texto de licencia de cada componente **realmente
enlazado en ese artefacto**:

- Siempre: GPLv3 (Quaero), MIT (cJSON, webview, solid-js, CodeMirror).
- Si trae el driver `sqlite`: aviso de dominio público de SQLite.
- Si trae el driver `mysql`: LGPL-2.1 de MariaDB Connector/C.
- Si trae el driver `mongodb`: Apache-2.0 + `NOTICE` de mongo-c-driver.
- Si se compiló con `QUAERO_SSH`: BSD-3-Clause de libssh2 (+ Apache-2.0/`NOTICE`
  de OpenSSL donde aplique).
