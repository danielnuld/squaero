# Protocolo IPC — núcleo ↔ frontend

El frontend (webview) y el núcleo (C) se comunican con **JSON-RPC 2.0** sobre el mecanismo `webview_bind`/`webview_eval` de la librería `webview`. Es la **única** frontera entre ambos mundos y se versiona con cuidado.

> **Protocolo v7.** El dispatcher JSON-RPC del núcleo está implementado y
> testeado (`core/src/ipc/`, entrada pública `dbcore_ipc_handle` en
> `core/include/dbcore/ipc.h`). Cubre el camino de datos de M1
> (`conn.open`/`conn.close`/`query.run` y el rango de errores de dominio
> `-32000..`), la introspección de M3 (`schema.*`), la edición transaccional de
> M7 (`tx.*` en v4, `row.*` en v5), la paginación por offset de `query.run`
> (`params.offset` en v6, issue #134) y la cancelación de una consulta en curso
> (`op.cancel` en v7). Este módulo es puro: JSON entra, JSON sale. El
> objeto `dsn` de `conn.open` es opaco al protocolo: el núcleo interpreta de él
> los campos `ssh_*` (túnel, abajo) de forma aditiva y compatible, sin cambiar la
> forma del método ni la versión.
>
> **Los métodos de abajo son la superficie IPC completa.** Import/Export (M8) y
> Transferencia/sincronización (M9) **no** agregan métodos: se implementan del
> lado del frontend componiendo `query.run` + `schema.*` + `row.*` + `tx.*` (ver
> [«Sin métodos para Import/Export/Transferencia»](#sin-métodos-para-importexporttransferencia--decisión-m8m9)).

## Forma de los mensajes

**Petición** (frontend → núcleo):

```json
{ "jsonrpc": "2.0", "id": 42, "method": "query.run",
  "params": { "connId": "c1", "sql": "SELECT * FROM users", "limit": 1000 } }
```

**Respuesta** (núcleo → frontend):

```json
{ "jsonrpc": "2.0", "id": 42,
  "result": { "columns": [...], "rows": [...], "truncated": false } }
```

**Error**:

```json
{ "jsonrpc": "2.0", "id": 42,
  "error": { "code": -32000, "message": "no se pudo conectar", "data": {...} } }
```

**Evento/notificación** (núcleo → frontend, sin `id`). *Planeado, aún no
implementado.* La forma reservada para el progreso de operaciones largas del lado
del núcleo sería:

```json
{ "jsonrpc": "2.0", "method": "progress",
  "params": { "op": "transfer", "done": 12000, "total": 50000 } }
```

`query.run` es la primera operación larga del lado del núcleo y **sí** es
cancelable con `op.cancel` (abajo), pero no emite `progress`: entrega el result
set de una sola vez (paginado), no en streaming. Import/Export y Transferencia
(M8/M9) siguen corriendo en el frontend acotados a la página cargada, así que no
emiten `progress`. Este bloque documenta la convención `progress` para cuando el
núcleo gane una operación larga con avance incremental (p. ej. copia con streaming).

## Métodos

Esta es la superficie IPC **completa** — cada método está registrado en el
dispatcher (`core/src/ipc/`) y verificado en tests. Los detalles de cada uno
están más abajo.

| Método | Desde | Descripción |
|---|---|---|
| `app.hello` | v2 | Handshake; negocia la versión del protocolo |
| `ping` | v2 | Liveness; eco de `params.message` |
| `conn.open` / `conn.close` | v2 | Abrir/cerrar conexión activa |
| `query.run` | v2 | Ejecutar SQL, devolver result set paginado |
| `op.cancel` | v7 | Cancelar la consulta en curso de una conexión (requiere `DBC_FEAT_CANCEL`) |
| `schema.tree` | v3 | Árbol de objetos (bases/esquemas/tablas), perezoso |
| `schema.describe` | v3 | Estructura de una tabla |
| `schema.ddl` | v3 | DDL `CREATE` de un objeto (requiere `DBC_FEAT_DDL`) |
| `tx.begin` / `tx.commit` / `tx.rollback` | v4 | Transacciones (requiere `DBC_FEAT_TRANSACTIONS`) |
| `row.insert` / `row.update` / `row.delete` | v5 | Edición de una fila (requiere `DBC_FEAT_DML`) |

No hay más métodos. En particular, **Import/Export (M8)** y
**Transferencia/sincronización (M9)** no agregan ninguno — se resuelven en el
frontend (ver abajo).

### Sin métodos para Import/Export/Transferencia — decisión M8/M9

Exportar, importar, transferir datos entre conexiones y comparar esquemas/datos
(«diff») se implementan **enteramente del lado del frontend** reutilizando los
métodos existentes; el núcleo no ganó ningún método para ellos:

- **Export** (CSV/JSON/SQL): el frontend serializa el result set ya cargado de
  `query.run` y lo descarga vía el navegador (`Blob` + `<a download>`).
- **Import** (CSV/JSON): el frontend parsea el archivo (`<input file>`) y ejecuta
  un `row.insert` por fila dentro de una transacción (`tx.begin`/`tx.commit`).
- **Transferencia** entre conexiones: se abre una segunda conexión con
  `conn.open` (el núcleo ya soporta varios `connId` simultáneos), se leen las
  filas de origen con `query.run` y se insertan en destino con `row.*`/`tx.*`.
- **Diff de esquema/datos**: el frontend compara la salida de `schema.describe`
  (estructura) o de `query.run` (filas, indexadas por PK) entre dos conexiones y
  materializa las diferencias como una tanda de `row.*` en una transacción.

Consecuencia honesta: estas operaciones están **acotadas a la página cargada** (no
hay streaming del lado del núcleo). Si en el futuro se necesita copia con
streaming para datasets grandes, será un método IPC nuevo con su propio issue,
versión de protocolo y el evento `progress` de arriba.

### Gestión de conexiones guardadas — sin método IPC (decisión M2)

Las **definiciones** de conexiones guardadas (nombre, motor, DSN sin
credenciales) son estado de configuración de la UI y se persisten en el lado del
frontend (almacenamiento local del webview), **no** en el núcleo. Por eso no
existen `conn.save` / `conn.list` / `conn.delete`: el núcleo solo gestiona el
ciclo de vida de la conexión *activa* (`conn.open` / `conn.close`) y nunca
retiene credenciales ni definiciones. Las contraseñas no se persisten: se piden
en el momento de conectar. Si en el futuro se decide centralizar la persistencia
en el núcleo, será un cambio con su propio issue y se reflejará aquí.

## Referencia de métodos

**`app.hello`** — handshake. Negocia la versión del protocolo.

```jsonc
// petición
{ "jsonrpc": "2.0", "id": 1, "method": "app.hello" }
// respuesta
{ "jsonrpc": "2.0", "id": 1,
  "result": { "name": "quaero", "coreVersion": "0.0.1", "protocolVersion": 5 } }
```

**`ping`** — liveness. Devuelve `{"pong": true}` y hace eco de `params.message`.

```jsonc
{ "jsonrpc": "2.0", "id": "x", "method": "ping", "params": { "message": "hi" } }
// -> result: { "pong": true, "echo": "hi" }
```

**`conn.open`** — abre una conexión activa a través de un driver registrado.
`params.driver` es el `name` del driver; `params.dsn` es el DSN como objeto JSON
(o como cadena JSON ya codificada). El DSN —y cualquier credencial que
contenga— se usa solo durante `connect` y **nunca** se persiste ni se retiene en
el núcleo. Devuelve un `connId` con forma `"c<N>"`.

```jsonc
{ "jsonrpc": "2.0", "id": 1, "method": "conn.open",
  "params": { "driver": "sqlite", "dsn": { "path": "/tmp/app.db" } } }
// -> result: { "connId": "c1" }
```

**`conn.close`** — cierra una conexión activa por `connId`.

```jsonc
{ "jsonrpc": "2.0", "id": 2, "method": "conn.close",
  "params": { "connId": "c1" } }
// -> result: { "closed": true }
```

Si el driver falla al conectar, el error se devuelve con el mensaje de
`last_error` del driver (ver códigos `-32000` abajo).

*SSL / TLS (específico del motor).* Los drivers de red interpretan campos `ssl_*`
del `dsn`. En MySQL/MariaDB (`DBC_FEAT_SSL`):

| Campo | Descripción |
|-------|-------------|
| `ssl_mode` | `disabled` \| `required` \| `verify_ca` \| `verify_identity`. `required` cifra sin verificar el certificado; `verify_ca` valida la cadena contra la CA; `verify_identity` además exige que el host coincida. |
| `ssl_ca` | Ruta al certificado CA. |
| `ssl_cert` / `ssl_key` | Certificado y clave del cliente (TLS mutuo). |

Se cablean con `mysql_ssl_set` + `MYSQL_OPT_SSL_MODE` antes de conectar. Un
`ssl_mode` no reconocido devuelve error de parámetro. A diferencia del túnel SSH,
los valores de `ssl_mode` son propios del motor (los de arriba son de MySQL).

*Informix (ODBC).* El driver `informix` se conecta a través del Administrador de
controladores ODBC, seleccionando en tiempo de ejecución el controlador *IBM
Informix ODBC Driver*. El `dsn` admite dos formas:

| Campo | Descripción |
|-------|-------------|
| `host` | Host del servidor Informix (forma directa). |
| `port` / `service` | Puerto TCP (número) o nombre de servicio. |
| `server` | Nombre de `INFORMIXSERVER` (requerido en la forma directa). |
| `protocol` | Protocolo de red (por defecto `onsoctcp`). |
| `database` | Base de datos inicial. |
| `user` / `password` | Credenciales. |
| `driver` | Sobrescribe el nombre del controlador ODBC registrado. |
| `odbc_dsn` | Forma alternativa: usa una fuente de datos ODBC ya configurada (`DSN=...`); ignora `host`/`server`/`driver`. |

La forma directa requiere `host` + `port`/`service` + `server`; la forma DSN
requiere `odbc_dsn`. El driver es de 32 bits (el CSDK lo es), por lo que Quaero
se compila en x86 — ver `cmake/toolchain-i686-mingw.cmake`.

*Túnel SSH (agnóstico al motor).* El núcleo reconoce, dentro del `dsn`, un grupo
de campos `ssh_*` y, cuando están presentes, abre un reenvío de puerto local
**antes** de invocar al driver, entregándole un DSN reescrito que apunta a
`127.0.0.1:<puerto_local>`. El driver no se entera del túnel. Campos:

| Campo | Descripción |
|-------|-------------|
| `ssh_host` | Servidor SSH. Su presencia activa el túnel. |
| `ssh_port` | Puerto SSH (por defecto `22`). |
| `ssh_user` | Usuario SSH (requerido si hay `ssh_host`). |
| `ssh_auth` | `password` \| `key` \| `agent` (por defecto `agent`). |
| `ssh_password` | Contraseña para `ssh_auth=password`. |
| `ssh_key` | Ruta a la clave privada para `ssh_auth=key`. |
| `ssh_key_passphrase` | Passphrase opcional de la clave. |
| `ssh_target_host` / `ssh_target_port` | Destino del reenvío (por defecto, el `host`/`port` del DSN). |
| `ssh_host_key_policy` | `accept-new` (por defecto) \| `strict` \| `off`. Verificación de la clave de host contra `known_hosts`. |
| `ssh_known_hosts` | Ruta al store `known_hosts` (por defecto `~/.ssh/known_hosts`). |

El reenvío real (libssh2) requiere una compilación con soporte de túnel
(`QUAERO_SSH`); sin él, abrir una conexión con `ssh_*` devuelve un error
explícito **no soportado** en lugar de conectarse directo, saltándose el salto
SSH previsto.

**Verificación de la clave de host (issue #81):** antes de autenticar, la clave
de host del servidor SSH se coteja contra `known_hosts` según
`ssh_host_key_policy`:
- `accept-new` (por defecto, TOFU): una clave desconocida se acepta y se
  **registra**; una clave **cambiada** se rechaza (posible MITM) con error explícito.
- `strict`: solo se aceptan hosts ya presentes en `known_hosts`.
- `off`: sin verificación (comportamiento heredado; no recomendado).
Un desajuste o una clave desconocida bajo `strict` aborta la conexión con un
mensaje claro, nunca entrega las credenciales a un host no verificado.

**`query.run`** — ejecuta SQL en una conexión activa y devuelve el result set
**paginado**. `params.limit` (opcional) acota las filas; si se omite aplica un
tope por defecto (1000) — nunca se vuelca el dataset completo. `params.offset`
(opcional, entero ≥ 0, **v6**) salta esa cantidad de filas iniciales para
**paginación por offset** (issue #134): el núcleo descarta las primeras `offset`
filas del cursor del driver y devuelve las siguientes `limit`. `truncated` indica
si había más filas de las devueltas — es decir, **si existe una página siguiente**.
El salto vive en el núcleo (`materialize.c`), no en cada driver, así que aplica a
cualquier motor sin cambios de vtable.

```jsonc
{ "jsonrpc": "2.0", "id": 3, "method": "query.run",
  "params": { "connId": "c1", "sql": "SELECT id, name FROM users", "limit": 1000, "offset": 0 } }
// -> result:
{ "columns": [ { "name": "id", "type": "int" }, { "name": "name", "type": "text" } ],
  "rows": [ ["1", "alice"], ["2", null] ],
  "truncated": false,
  "rowsAffected": 0 }
```

Cada celda viaja como **cadena** (su forma textual) o `null` para un `NULL` SQL;
el `type` neutral de cada columna le dice al frontend cómo formatearla (el núcleo
no infiere ni convierte). Una sentencia sin result set (`INSERT`/`UPDATE`/DDL)
devuelve `columns: []`, `rows: []` y `rowsAffected` con el conteo.

**`op.cancel`** — solicita cancelar la consulta que está corriendo en una
conexión. `params: { connId }`; resultado `{ canceled: bool }`. Como una conexión
ejecuta una consulta a la vez, basta el `connId`: el núcleo busca la operación en
curso y llama al hook `cancel` del driver. `canceled` es `true` **solo** cuando se
entregó una cancelación al driver; una consulta que ya terminó (carrera benigna) o
un motor que no puede cancelar devuelven `canceled: false` — ninguno es un error, y
el frontend rehabilita su UI igual. Es *best-effort*: la consulta interrumpida
falla luego con un error de consulta (`-32003`), que llega como el error normal de
`query.run`.

La cancelación real requiere que el driver anuncie `DBC_FEAT_CANCEL`; un motor sin
soporte devuelve `canceled: false` en vez de fingir. A diferencia del resto de los
métodos, el shell nativo despacha `op.cancel` **sin** encolarlo detrás de la
consulta que interrumpe, y el hook `cancel` del driver corre en otro hilo mientras
`query.run` sigue en vuelo — la única excepción documentada a la regla de un hilo
por conexión (ver `docs/DRIVER_API.md`).

```jsonc
{ "jsonrpc": "2.0", "id": 3, "method": "op.cancel",
  "params": { "connId": "c1" } }
// -> result: { "canceled": true }
```

**`schema.tree`** — lista perezosa de un nivel del árbol de objetos. Sin `db`
devuelve las **bases de datos**; con `db` (y sin `schema`) devuelve los
**esquemas** del motor que los tenga (`DBC_FEAT_SCHEMAS`) o, si no, las **tablas**
de esa base; con `schema` (o `db`+`schema`) devuelve las **tablas/vistas**. El
resultado es un result set: las bases/esquemas traen una columna `name`; las
tablas traen `name` y `type` (`"table"`/`"view"`). El driver sin
`DBC_FEAT_INTROSPECTION` responde error `-32001`.

```jsonc
{ "jsonrpc": "2.0", "id": 4, "method": "schema.tree",
  "params": { "connId": "c1", "db": "main" } }
// -> result: { "columns": [ {"name":"name","type":"text"}, {"name":"type","type":"text"} ],
//             "rows": [ ["users","table"], ["adults","view"] ], "truncated": false, "rowsAffected": 0 }
```

**`schema.describe`** — estructura de una tabla: una fila por columna. Para
SQLite las columnas son `name`, `type` (tipo declarado por el motor), `notnull`,
`dflt_value` y `pk`. `params: { connId, table, db?, schema? }`. El contenedor
opcional (`schema`, o `db` si no hay esquemas) permite describir tablas fuera de
la base por defecto.

**`schema.ddl`** — sentencia `CREATE` de un objeto, como result set de una
columna `sql`. `params: { connId, object, db?, schema? }`. Requiere
`DBC_FEAT_DDL`.

Las tres comparten la forma de result set de `query.run` y los mismos códigos de
error de dominio (`-32001` no soportado, `-32002` conexión desconocida, etc.).

### Transacciones (M7)

**`tx.begin`** / **`tx.commit`** / **`tx.rollback`** — control de transacción
sobre la conexión activa. `params: { connId }`; resultado `{ ok: true }`. Sirven
para agrupar una tanda de ediciones (`row.*`) y confirmarlas o descartarlas en
bloque (edición segura, issue #28). Requieren que el driver anuncie
`DBC_FEAT_TRANSACTIONS`; un motor sin soporte devuelve `-32001` (no soportado)
en lugar de fingir éxito. Los motores SQL (SQLite, MySQL/MariaDB) los soportan;
MongoDB no los anuncia.

### Edición de datos (M7)

**`row.insert`** / **`row.update`** / **`row.delete`** — modifican una sola fila.
El cambio se expresa con objetos `{columna: valor}` (un valor `null` JSON es SQL
NULL); la fila a modificar se identifica por su clave primaria en `where`.

- `row.insert` — `params: { connId, table, schema?, values:{...}, setTypes?, preview? }`.
- `row.update` — `params: { connId, table, schema?, set:{...}, where:{...}, setTypes?, preview? }`.
- `row.delete` — `params: { connId, table, schema?, where:{...}, preview? }`.

`setTypes` (opcional) es un objeto `{columna: tipoNeutral}` con el tipo de cada
columna de `set`/`values` (`"int"`, `"float"`, `"bool"`, `"text"`, …). Permite que
el driver emita las columnas numéricas **sin comillas** (p. ej. MySQL rechaza un
string `'0'` en una columna `BIT`); si se omite, el driver entrecomilla todo (como
antes). Es aditivo y retrocompatible.

Resultado `{ sql: string, rowsAffected?: number }`. Con `preview: true` solo se
**genera** la sentencia (se devuelve en `sql`, sin ejecutar ni `rowsAffected`);
sin `preview` se genera y además se ejecuta. El driver construye el SQL literal
(`build_dml`), así que el `sql` del preview es exactamente el que se ejecuta al
confirmar (issue #29). El núcleo rechaza un `UPDATE`/`DELETE` sin `where` (jamás
afecta todas las filas). Requiere `DBC_FEAT_DML`; MongoDB no lo anuncia (solo
lectura). La edición segura se agrupa con `tx.begin`/`tx.commit`/`tx.rollback`.

### Códigos de error

JSON-RPC estándar:

| Código | Significado | Cuándo |
|---|---|---|
| `-32700` | Parse error | JSON inválido |
| `-32600` | Invalid Request | no es objeto, o falta `method` |
| `-32601` | Method not found | método desconocido |
| `-32602` | Invalid params | parámetros inválidos |
| `-32603` | Internal error | fallo interno del núcleo |

Dominio (rango reservado por el servidor `-32000..-32099`):

| Código | Significado | Cuándo |
|---|---|---|
| `-32000` | Connection error | el driver no pudo abrir/usar la conexión (`message` = `last_error`) |
| `-32001` | Unsupported | operación no soportada por el driver |
| `-32002` | Not found | `connId` o driver desconocido |
| `-32003` | Query error | la consulta falló al ejecutar o iterar (`message` = `last_error`) |

El `id` de la petición se refleja en la respuesta (o `null` si no venía).

## Reglas

1. **Paginación siempre.** `query.run` devuelve como máximo `limit` filas y marca `truncated`. La UI pide más bajo demanda. Nunca se vuelca un dataset completo de golpe.
2. **El núcleo es la fuente de verdad de los tipos.** Cada columna lleva su `type` neutral; el frontend formatea, no infiere.
3. **Operaciones largas.** `query.run` es una operación larga del núcleo y es cancelable con `op.cancel` (implementado). El shell la despacha en un hilo worker para no congelar la UI, y `op.cancel` viaja por un canal que no se encola detrás de la consulta que interrumpe. `progress` sigue reservado (no implementado): hoy `query.run` no reporta avance incremental, y import/export/transfer corren en el frontend acotados a la página.
4. **Versionado:** el handshake inicial (`app.hello`) negocia la versión del protocolo. Ver [«Notas de versionado»](#notas-de-versionado).

## Notas de versionado

El protocolo IPC y la ABI de la vtable (`docs/DRIVER_API.md`) se versionan por
separado: el protocolo cuenta la forma de los mensajes núcleo↔frontend; la ABI
cuenta el layout de la vtable núcleo↔driver. Suelen subir juntos porque una
capacidad nueva toca ambos, pero no tienen por qué.

**Cómo se negocia.** Al arrancar, el frontend llama `app.hello` y lee
`result.protocolVersion` (hoy **7**). Esa es la fuente de verdad en runtime; la
constante vive en el núcleo (`app.hello` la reporta) y este documento la refleja.

**Qué sube la versión del protocolo** (cualquiera de estos es un cambio
incompatible que debe discutirse en un issue antes, porque rompe a todo cliente):

- agregar, quitar o renombrar un método;
- cambiar la forma de los `params` o del `result` de un método existente;
- cambiar el significado o el rango de un código de error.

**Qué NO la sube** (extensiones compatibles):

- interpretar campos nuevos y opcionales dentro del `dsn` opaco de `conn.open`
  (así se agregaron `ssl_*` y `ssh_*` sin tocar la versión);
- agregar un campo opcional a un `result` que los clientes viejos ignoran.

**Historial:**

| Protocolo | Milestone | Cambio |
|---|---|---|
| v2 | M1 | `app.hello`, `ping`, `conn.open`/`conn.close`, `query.run` |
| v3 | M3 | `schema.tree`/`schema.describe`/`schema.ddl` |
| v4 | M7 | `tx.begin`/`tx.commit`/`tx.rollback` |
| v5 | M7 | `row.insert`/`row.update`/`row.delete` |
| v6 | M10.6 | `query.run` acepta `params.offset` (paginación por offset, #134) |
| v7 | M10.6 | `op.cancel`: cancelar la consulta en curso de una conexión |

M8 (Import/Export) y M9 (Transferencia/sincronización) **no** subieron la versión:
se implementaron en el frontend sobre los métodos existentes. La v6 sí sube porque
añade un parámetro nuevo a un método (aunque sea opcional y compatible). La v7 sube
porque agrega un método nuevo (`op.cancel`).
