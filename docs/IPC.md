# Protocolo IPC — núcleo ↔ frontend

El frontend (webview) y el núcleo (C) se comunican con **JSON-RPC 2.0** sobre el mecanismo `webview_bind`/`webview_eval` de la librería `webview`. Es la **única** frontera entre ambos mundos y se versiona con cuidado.

> **Protocolo v2.** El dispatcher JSON-RPC del núcleo está implementado y
> testeado (`core/src/ipc/`, entrada pública `dbcore_ipc_handle` en
> `core/include/dbcore/ipc.h`). v2 añade `conn.open`/`conn.close` y el rango de
> errores de dominio `-32000..`. Este módulo es puro: JSON entra, JSON sale.

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

**Evento/notificación** (núcleo → frontend, sin `id`) para progreso de operaciones largas (transfer, import):

```json
{ "jsonrpc": "2.0", "method": "progress",
  "params": { "op": "transfer", "done": 12000, "total": 50000 } }
```

## Métodos (esbozo, crece por milestone)

| Método | Fase | Descripción |
|---|---|---|
| `conn.list` / `conn.save` / `conn.delete` | M2 | Gestión de conexiones guardadas |
| `conn.open` / `conn.close` | M1/M2 | Abrir/cerrar conexión activa |
| `query.run` | M1 | Ejecutar SQL, devolver result set paginado |
| `schema.tree` | M3 | Árbol de objetos (bases/esquemas/tablas) |
| `schema.describe` | M3 | Estructura de una tabla |
| `schema.ddl` | M3 | DDL `CREATE` de un objeto |
| `row.update` / `row.insert` / `row.delete` | M5 | Edición de datos |
| `tx.begin` / `tx.commit` / `tx.rollback` | M5 | Transacciones |
| `data.export` / `data.import` | M6 | Import/Export |
| `data.transfer` / `schema.diff` / `data.diff` | M7 | Transferencia y sincronización |

## Implementado (v2)

**`app.hello`** — handshake. Negocia la versión del protocolo.

```jsonc
// petición
{ "jsonrpc": "2.0", "id": 1, "method": "app.hello" }
// respuesta
{ "jsonrpc": "2.0", "id": 1,
  "result": { "name": "quaero", "coreVersion": "0.0.1", "protocolVersion": 2 } }
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

El `id` de la petición se refleja en la respuesta (o `null` si no venía).

## Reglas

1. **Paginación siempre.** `query.run` devuelve como máximo `limit` filas y marca `truncated`. La UI pide más bajo demanda. Nunca se vuelca un dataset completo de golpe.
2. **El núcleo es la fuente de verdad de los tipos.** Cada columna lleva su `type` neutral; el frontend formatea, no infiere.
3. **Operaciones largas son asíncronas** y emiten `progress`; pueden cancelarse con `op.cancel`.
4. **Versionado:** el handshake inicial (`app.hello`) negocia la versión del protocolo.
