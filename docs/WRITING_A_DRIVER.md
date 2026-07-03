# Cómo escribir un driver

Guía paso a paso para dar soporte a un motor de base de datos nuevo en Quaero.
Un driver es el camino más valioso para contribuir: cada uno abre Quaero a un
motor entero sin tocar el núcleo ni la interfaz.

**Antes de empezar**, lee el [contrato de la vtable](DRIVER_API.md) — es la
fuente de verdad. Esta guía lo recorre en orden práctico; el header
[`core/include/dbcore/driver.h`](../core/include/dbcore/driver.h) manda ante
cualquier duda.

## El modelo mental

```
Frontend (webview)  ──IPC JSON──>  Núcleo (libdbcore)  ──vtable──>  Tu driver  ──>  Motor
```

Un driver es una **biblioteca compartida** (`.dll`/`.so`/`.dylib`) que exporta un
único símbolo (`dbc_driver_entry`) y devuelve una **tabla de funciones** (la
vtable). El núcleo la carga en runtime, valida la ABI y opera solo contra esa
tabla — nunca conoce detalles de tu motor. Reglas que no se negocian:

- **El driver depende solo de la ABI** (`dbcore/driver.h`), nunca del código del
  núcleo. Se enlaza con `quaero::driver_sdk` y con la librería cliente del motor.
- **Honestidad de capacidades:** anuncias una capacidad (`DBC_FEAT_*`) *solo* si
  un handler real la respalda. Lo no soportado devuelve `DBC_ERR_UNSUPPORTED`,
  nunca un éxito vacío falso.
- **Lógica pura, testeable:** el mapeo de tipos, el quoting de identificadores y
  la construcción de SQL viven en módulos `utils/` pequeños con tests unitarios.

## Paso 0 — Prepara el SDK

En el árbol de fuentes de Quaero el SDK ya está disponible como target
(`quaero::driver_sdk`). Para construir tu driver **fuera** del árbol, instálalo:

```sh
cmake -S . -B build
cmake --install build --prefix <prefijo>   # instala dbcore/driver.h + el paquete CMake
```

Ver [«Empaquetado y consumo del SDK»](DRIVER_API.md#empaquetado-y-consumo-del-sdk).

## Paso 1 — Copia la plantilla

Parte del **driver de plantilla**: [`examples/driver-template/`](../examples/driver-template/).
Es el driver mínimo que satisface la ABI (solo los miembros obligatorios, sin
dependencias externas, sirviendo una tabla fija en memoria). Cópialo a
`drivers/<tu-motor>/` (si contribuyes al repo) o a tu propio proyecto.

```
drivers/mi_motor/
  CMakeLists.txt
  src/
    internal.h      formas de dbc_conn / dbc_result + prototipos
    entry.c         cablea la vtable, exporta dbc_driver_entry
    connection.c    connect / disconnect / last_error
    query.c         query + lectura del result set
    utils/
      types.c       mapeo tipo-del-motor -> dbc_type   (puro, con tests)
```

> El driver de referencia de **SQLite** (`drivers/sqlite/`) implementa *todas*
> las capacidades de forma mínima y clara. Tenlo abierto como ejemplo completo
> mientras la plantilla te da el esqueleto.

Renombra todo `example` → tu id de motor. El `name` de la vtable es lo que
`conn.open` selecciona; elige un id estable en minúsculas (`postgres`, `oracle`).

## Paso 2 — Identidad

En `entry.c`, rellena la sección de identidad de la vtable:

```c
.abi_version  = DBC_ABI_VERSION,   /* siempre esta constante; el cargador la valida */
.name         = "mi_motor",        /* id estable, lo usa conn.open */
.display_name = "Mi Motor",        /* etiqueta legible para la UI */
```

## Paso 3 — Conectar

En `connection.c`, implementa `connect`/`disconnect`/`last_error`. El DSN llega
como **cadena JSON** (`{"host":"...","port":5432,"user":"..."}`); parséalo (el
driver de SQLite usa el cJSON vendido en `third_party/`) y abre la conexión del
motor, guardando el handle nativo en tu `struct dbc_conn`.

- `connect` reserva la `dbc_conn`; `disconnect` la libera.
- `last_error` **nunca** devuelve `NULL`: el núcleo lo imprime ante cualquier
  `DBC_ERR_*`.
- Ante un fallo de conexión, devuelve `DBC_ERR_CONN` y deja el motivo en
  `last_error`.

No manejes SSL ni túneles SSH tú mismo salvo que el motor lo requiera: los campos
`ssh_*` del DSN los procesa el núcleo **antes** de llamarte (te entrega un DSN
reescrito a `127.0.0.1:<puerto_local>`). Los campos `ssl_*` sí son del driver si
tu motor cifra el transporte (ver el driver de MySQL).

## Paso 4 — Ejecutar y leer resultados

En `query.c`:

- `query(c, sql, &out)` ejecuta el SQL y reserva un `dbc_result`.
- La lectura del result set es un cursor: `col_count`, `col_name`, `col_type`,
  `next_row` (1 = fila lista, 0 = fin, <0 = error) y `cell_text` (devuelve la
  forma **textual** de la celda, o `NULL` para SQL NULL).
- `rows_affected` devuelve el conteo de una sentencia sin result set
  (INSERT/UPDATE/DDL); 0 para un SELECT.

**Mapeo de tipos (módulo puro).** `col_type` devuelve un `dbc_type` neutral
(`DBC_TYPE_INT`, `DBC_TYPE_TEXT`, …); el núcleo y la UI nunca ven códigos del
motor. Extrae la traducción motor→neutral a `utils/types.c` y cúbrela con tests
(nominal, límite, desconocido). `DBC_TYPE_NULL` es «tipo indeterminado», **no**
«celda NULL».

**Propiedad de memoria:** todo `const char*` que devuelvas es tuyo y debe vivir
hasta que se libere el handle dueño — para `cell_text`/`col_name`, hasta el
siguiente `next_row`/`free_result`. El núcleo nunca los libera.

Con esto ya tienes un driver de solo lectura funcional. Compílalo (paso 6) y
pruébalo antes de seguir.

## Paso 5 — Añade capacidades, una a la vez

Cada capacidad opcional es un grupo de miembros de la vtable **y** un flag en
`features`. Impleméntala, testéala y *solo entonces* enciende su bit. Ver
[«Checklist de features»](#checklist-de-features).

- **Introspección** (`DBC_FEAT_INTROSPECTION`) — `list_databases`,
  `list_schemas` (si el motor tiene esquemas dentro de una base — enciende
  también `DBC_FEAT_SCHEMAS`), `list_tables`, `describe_table`. Devuelven result
  sets con columnas convenidas (ver abajo). Suele vivir en `metadata.c`.
- **DDL** (`DBC_FEAT_DDL`) — `get_ddl` devuelve el `CREATE` de un objeto como
  result set de una columna `sql`. En `ddl.c`.
- **Transacciones** (`DBC_FEAT_TRANSACTIONS`) — `begin`/`commit`/`rollback`.
- **Edición** (`DBC_FEAT_DML`) — `build_dml` construye el SQL literal de un
  INSERT/UPDATE/DELETE de una fila y lo devuelve como result set `sql` (igual que
  `get_ddl`); el núcleo lo previsualiza y/o ejecuta. **Escapa** identificadores y
  literales, y **rechaza** un UPDATE/DELETE sin clave (jamás afectes todas las
  filas). El armado del SQL va en un módulo puro `utils/dml.c` con tests.

**Convención de columnas de introspección** (para que el núcleo y la UI las
consuman igual en todo motor):

| Función | Columnas del result set |
|---|---|
| `list_databases` / `list_schemas` | `name` |
| `list_tables` | `name`, `type` (`"table"`/`"view"`) |
| `describe_table` | `name`, `type`, `notnull`, `dflt_value`, `pk` |
| `get_ddl` / `build_dml` | `sql` |

## Paso 6 — Compila y coloca el plugin

Tu `CMakeLists.txt` (partiendo del de la plantilla) construye un `MODULE` que
enlaza el SDK y tu librería cliente:

```cmake
find_package(QuaeroDriverSDK REQUIRED)          # fuera del árbol; in-tree ya existe
add_library(mi_driver MODULE src/entry.c src/connection.c src/query.c ...)
target_link_libraries(mi_driver PRIVATE quaero::driver_sdk <cliente_del_motor>)
set_target_properties(mi_driver PROPERTIES PREFIX "" OUTPUT_NAME "mi_motor")
```

El nombre de archivo debe ser `mi_motor.<ext>` (sin prefijo `lib`) para que el
cargador lo reconozca. Coloca el binario en el directorio `drivers/` junto al
ejecutable `quaero`; al arrancar, la app escanea ese directorio y registra cada
plugin válido. Verás en el log `loaded driver 'mi_motor'`.

## Paso 7 — Muéstralo en la interfaz

El formulario de conexión es *data-driven*: agrega una entrada al arreglo
`AVAILABLE_DRIVERS` y una `DriverSchema` (con sus `fields` de DSN) en
[`frontend/src/utils/connections.ts`](../frontend/src/utils/connections.ts). El
`driver` de la schema debe coincidir con el `name` de tu vtable. Para un motor de
red, compón los campos de túnel SSH con `withSshTunnel()`. Los campos `password`
se excluyen automáticamente del almacenamiento (los secretos nunca se persisten).

## Paso 8 — Pruebas

No hay driver «terminado» sin pruebas (ver [convenciones](../.rules/testing.md)):

- **Seams puros** (`utils/types.c`, `utils/identifier.c`, `utils/dml.c`) → tests
  unitarios: caso nominal, límites y entrada no soportada. Compilan en **todas**
  las plataformas aunque la librería cliente no esté presente.
- **Smoke / integración** contra un servidor real, protegido por variable de
  entorno para que haga *skip* (verde) cuando no hay servidor — así CI no falla
  donde el motor no está. El driver de MySQL/MongoDB tiene un job de integración
  dedicado como modelo.

> Ojo: el código que toca la librería cliente **suele compilar solo en CI** (la
> matriz instala el cliente por leg). Mantén la lógica no trivial en los seams
> puros — esos sí los compilas y testeas localmente — y revisa el C con cuidado
> antes de subir.

Construir + testear: `ctest` en el núcleo. Cada driver aporta sus propios tests
bajo `drivers/<motor>/tests/`.

## Disciplina de ABI

Compila siempre contra `DBC_ABI_VERSION`. El cargador valida **igualdad exacta**
de versión: un driver de una ABI anterior se rechaza limpiamente, no se lee con
un layout distinto. No reordenes ni insertes miembros en la vtable — eso es un
cambio de ABI del núcleo, con su propio issue. Tu trabajo es *implementar* la
vtable vigente, no cambiarla.

## Checklist de features

Usa esto para saber qué falta y no anunciar de más. Enciende cada bit **solo**
cuando su handler real esté implementado y testeado.

- [ ] **Identidad** — `abi_version` = `DBC_ABI_VERSION`, `name`, `display_name`.
- [ ] **Conexión** (obligatorio) — `connect`, `disconnect`, `last_error` (nunca NULL).
- [ ] **Ejecución** (obligatorio) — `query`, `free_result`.
- [ ] **Lectura** (obligatorio) — `col_count`, `col_name`, `col_type`, `next_row`, `cell_text`, `rows_affected`.
- [ ] **Mapeo de tipos** en un módulo puro con tests (nominal/límite/desconocido).
- [ ] `DBC_FEAT_INTROSPECTION` — `list_databases`, `list_tables`, `describe_table` (+ `list_schemas` y `DBC_FEAT_SCHEMAS` si el motor tiene esquemas), con las columnas convenidas.
- [ ] `DBC_FEAT_DDL` — `get_ddl` (columna `sql`).
- [ ] `DBC_FEAT_TRANSACTIONS` — `begin`, `commit`, `rollback`.
- [ ] `DBC_FEAT_DML` — `build_dml` (escapa identificadores/literales; rechaza UPDATE/DELETE sin clave).
- [ ] `DBC_FEAT_SSL` — campos `ssl_*` del DSN, si el motor cifra el transporte.
- [ ] Registrado en el frontend (`AVAILABLE_DRIVERS` + `DriverSchema`).
- [ ] Tests: seams puros + smoke/integración con *skip* verde sin servidor.
- [ ] Toda operación no soportada devuelve `DBC_ERR_UNSUPPORTED` (sin éxitos falsos).
