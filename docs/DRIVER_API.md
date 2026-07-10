# Contrato de drivers (vtable)

Un driver es una biblioteca compartida (`.dll`/`.so`/`.dylib`) que exporta una función de entrada conocida y devuelve una **tabla de funciones** (vtable). El núcleo carga el plugin con `LoadLibrary`/`dlopen`, resuelve el símbolo de entrada y opera contra la vtable sin conocer detalles del motor.

> **Fuente de verdad:** la definición canónica vive en
> [`core/include/dbcore/driver.h`](../core/include/dbcore/driver.h). Este
> documento describe el mismo contrato en prosa y **debe mantenerse
> sincronizado** con el header. Ante cualquier discrepancia, el header manda.

ABI actual: **`DBC_ABI_VERSION = 5`**.

## Punto de entrada

Cada plugin exporta un único símbolo, cuyo nombre canónico es
`dbc_driver_entry` (constante `DBC_DRIVER_ENTRY_SYMBOL` para el cargador):

```c
/* Devuelve la vtable del driver. El núcleo verifica abi_version al cargar. */
DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void);
```

`DBC_DRIVER_EXPORT` (definido en `driver.h`) marca el símbolo como exportado para
que el cargador lo resuelva con `GetProcAddress`/`dlsym` en cualquier toolchain.
La vtable devuelta es propiedad del driver (normalmente almacenamiento estático)
y vive mientras la biblioteca esté cargada.

## Versionado de ABI

```c
#define DBC_ABI_VERSION 5
```

El driver graba en `dbc_driver_t.abi_version` el valor contra el que se compiló.
El cargador del núcleo valida la vtable **antes** de usarla mediante:

```c
dbc_status dbc_driver_validate(const dbc_driver_t *drv);
```

Devuelve:

| Resultado | Significado |
|---|---|
| `DBC_OK` | la vtable es usable |
| `DBC_ERR_PARAM` | `drv` es `NULL` |
| `DBC_ERR_ABI` | `drv->abi_version != DBC_ABI_VERSION` |
| `DBC_ERR_UNSUPPORTED` | falta un miembro **obligatorio** (identidad o puntero de función requerido) |

**Disciplina de ABI:** cambiar el layout de la vtable (incluido **agregar**
miembros, aunque sea al final), los valores existentes de un enum, o el conjunto
de miembros obligatorios, sube `DBC_ABI_VERSION`. Como el cargador valida
igualdad exacta de versión, un driver compilado contra un ABI anterior se
rechaza limpiamente en vez de leerse con un layout distinto. Las capacidades
nuevas se agregan al final y se protegen con un flag `DBC_FEAT_*` para que el
núcleo solo invoque el miembro cuando el driver lo advierte (p. ej. `get_ddl` en
ABI 2).

## Tipos de estado y de dato

`dbc_status` y los códigos `DBC_ERR_*` viven en el header mínimo
`dbcore/status.h`, que `dbcore/driver.h` re-exporta; un driver solo necesita
incluir `driver.h`. Los valores no cambian.

```c
typedef enum {
    DBC_OK = 0,
    DBC_ERR_CONN,         /* conexión fallida o inválida */
    DBC_ERR_QUERY,        /* error de ejecución / result set */
    DBC_ERR_PARAM,        /* argumento inválido del núcleo (p. ej. NULL) */
    DBC_ERR_UNSUPPORTED,  /* operación no soportada por el motor */
    DBC_ERR_ABI,          /* ABI del driver incompatible con el núcleo */
    DBC_ERR_NOMEM         /* fallo de reserva de memoria */
} dbc_status;

typedef enum {
    DBC_TYPE_NULL = 0,
    DBC_TYPE_INT,
    DBC_TYPE_FLOAT,
    DBC_TYPE_BOOL,
    DBC_TYPE_TEXT,
    DBC_TYPE_BLOB,
    DBC_TYPE_DATE,
    DBC_TYPE_TIME,
    DBC_TYPE_TIMESTAMP,
    DBC_TYPE_JSON
} dbc_type;
```

`col_type` devuelve un `dbc_type` neutral. El mapeo motor→neutral lo hace el
driver; el núcleo y la UI nunca ven códigos de tipo específicos del motor.
`DBC_TYPE_NULL` es el tipo de una columna cuyo tipo no se puede determinar — **no**
significa que la celda sea `NULL` (eso lo indica `cell_text` devolviendo `NULL`).

## Capacidades

```c
#define DBC_FEAT_SSL           (1u << 0)  /* transporte TLS/SSL */
#define DBC_FEAT_SSH_TUNNEL    (1u << 1)  /* conexión vía túnel SSH */
#define DBC_FEAT_TRANSACTIONS  (1u << 2)  /* begin/commit/rollback */
#define DBC_FEAT_SCHEMAS       (1u << 3)  /* el motor tiene esquemas dentro de una base */
#define DBC_FEAT_INTROSPECTION (1u << 4)  /* list_* / describe_table */
#define DBC_FEAT_DDL           (1u << 5)  /* get_ddl: CREATE de un objeto */
#define DBC_FEAT_DML           (1u << 6)  /* build_dml: insert/update/delete de una fila */
```

`dbc_driver_t.features` es el OR de los flags soportados. Un driver advierte una
capacidad **solo** si un handler real la respalda; la UI oculta lo ausente. Las
operaciones no advertidas devuelven `DBC_ERR_UNSUPPORTED`, nunca un éxito vacío
falso.

## La vtable

```c
typedef struct dbc_conn   dbc_conn;    /* opaco, definido por el driver */
typedef struct dbc_result dbc_result;  /* opaco, definido por el driver */

typedef struct {
    /* --- identidad (obligatorio) --- */
    int          abi_version;   /* debe ser DBC_ABI_VERSION */
    const char  *name;          /* id estable: "sqlite", "postgres", ... */
    const char  *display_name;  /* etiqueta legible: "SQLite", "PostgreSQL" */

    /* --- ciclo de vida de la conexión (obligatorio) --- */
    dbc_status  (*connect)(const char *dsn_json, dbc_conn **out);
    void        (*disconnect)(dbc_conn *c);
    const char *(*last_error)(dbc_conn *c);  /* nunca NULL */

    /* --- ejecución (obligatorio) --- */
    dbc_status  (*query)(dbc_conn *c, const char *sql, dbc_result **out);
    void        (*free_result)(dbc_result *r);

    /* --- lectura del result set (obligatorio) --- */
    int          (*col_count)(dbc_result *r);
    const char  *(*col_name)(dbc_result *r, int col);
    dbc_type     (*col_type)(dbc_result *r, int col);
    int          (*next_row)(dbc_result *r);            /* 1=fila, 0=fin, <0=error */
    const char  *(*cell_text)(dbc_result *r, int col);  /* NULL si SQL NULL */
    long long    (*rows_affected)(dbc_result *r);

    /* --- introspección (opcional; DBC_FEAT_INTROSPECTION) --- */
    dbc_status  (*list_databases)(dbc_conn *c, dbc_result **out);
    dbc_status  (*list_schemas)(dbc_conn *c, const char *db, dbc_result **out);
    dbc_status  (*list_tables)(dbc_conn *c, const char *schema, dbc_result **out);
    dbc_status  (*describe_table)(dbc_conn *c, const char *schema, const char *table, dbc_result **out);

    /* --- transacciones (opcional; DBC_FEAT_TRANSACTIONS) --- */
    dbc_status  (*begin)(dbc_conn *c);
    dbc_status  (*commit)(dbc_conn *c);
    dbc_status  (*rollback)(dbc_conn *c);

    /* --- capacidades --- */
    unsigned int features;   /* OR de DBC_FEAT_* */

    /* --- generación de DDL (opcional; DBC_FEAT_DDL) ---
       Añadido en ABI 2; ganó el argumento `schema` en ABI 3. Devuelve el
       CREATE de `object` como result set de una columna ("sql"), o
       DBC_ERR_UNSUPPORTED si no se implementa. */
    dbc_status  (*get_ddl)(dbc_conn *c, const char *schema, const char *object, dbc_result **out);

    /* --- modificación de datos (opcional; DBC_FEAT_DML; añadido en ABI 4) ---
       Construye el SQL literal que aplica `row` (insert/update/delete de una
       fila; ver dbc_dml_kind) y lo devuelve como result set de una columna
       ("sql"), igual que get_ddl. El núcleo lo previsualiza y/o lo ejecuta por
       la vía normal de query. DBC_ERR_UNSUPPORTED si no se implementa. */
    dbc_status  (*build_dml)(dbc_conn *c, dbc_dml_kind kind, const dbc_dml_row *row, dbc_result **out);
} dbc_driver_t;
```

Los miembros **obligatorios** (identidad, ciclo de vida, ejecución y lectura del
result set) deben ser no-`NULL` en todo driver y los verifica
`dbc_driver_validate`. Los miembros **opcionales** (introspección, transacciones,
`get_ddl`, `build_dml`) pueden ser `NULL` cuando la capacidad correspondiente no
se advierte en `features`.

El cambio de una fila viaja al driver como un `dbc_dml_row` neutral (tabla,
columnas/valores a asignar, columnas/valores de la clave para el `WHERE`); un
valor `NULL` significa SQL NULL. El driver escapa identificadores y literales y
deja que el motor coaccione el tipo. Ver el header para la definición exacta de
`dbc_dml_kind` y `dbc_dml_row`.

Desde **ABI 5**, `dbc_dml_row.set_types` lleva el tipo neutral de cada valor de
`set` (paralelo a `set_cols`/`set_vals`, o `NULL` si se desconoce). Permite al
driver emitir columnas numéricas (`int`/`float`) **sin comillas** —necesario
porque algunos motores rechazan un string entrecomillado en una columna numérica
(p. ej. MySQL rechaza `'0'` en una columna `BIT`)—. Con `set_types == NULL` el
driver entrecomilla todos los valores (comportamiento previo).

**Convención de las columnas de introspección** (para que el núcleo y la UI las
consuman de forma uniforme): `list_databases`/`list_schemas` devuelven una
columna `name`; `list_tables` devuelve `name` y `type` (`"table"`/`"view"`);
`describe_table` devuelve una fila por columna con `name`, `type` (el tipo
declarado por el motor), `notnull`, `dflt_value` y `pk`; `get_ddl` devuelve una
columna `sql`.

## Contrato de comportamiento

- **Propiedad de memoria:** `connect` reserva una `dbc_conn` y `disconnect` la
  libera; `query` reserva un `dbc_result` y `free_result` lo libera. Todo
  `const char*` devuelto por la vtable es propiedad del driver y vive hasta que
  se libera el handle dueño (para `cell_text`/`col_name`, hasta el siguiente
  `next_row`/`free_result`). El núcleo nunca los libera.
- **Thread-safety:** una `dbc_conn` se usa desde un solo hilo a la vez; el núcleo
  serializa el acceso. Conexiones distintas pueden usarse en paralelo.
- **DSN:** la cadena de conexión llega como **JSON**
  (`{"host":...,"port":...,"user":...}`) para no acoplar el núcleo a parámetros
  específicos del motor.
- **Errores:** ante `DBC_ERR_*`, `last_error` devuelve un mensaje legible. La
  librería nunca llama a `abort()`.

## Empaquetado y consumo del SDK

El único archivo público contra el que se compila un driver es este header,
`dbcore/driver.h`. Quaero lo distribuye como un **paquete CMake versionado**
(`QuaeroDriverSDK`), independiente del núcleo GPL: un driver depende solo de la
ABI, nunca del código del núcleo.

Instala el SDK desde el árbol de fuentes:

```sh
cmake -S . -B build
cmake --install build --prefix <prefijo>
```

Eso instala `include/dbcore/driver.h` y la config del paquete en
`lib/cmake/QuaeroDriverSDK/`. Un driver externo lo consume así:

```cmake
find_package(QuaeroDriverSDK REQUIRED)
add_library(mi_driver MODULE src/entry.c src/driver.c)
target_link_libraries(mi_driver PRIVATE quaero::driver_sdk)
set_target_properties(mi_driver PROPERTIES PREFIX "" OUTPUT_NAME "mi_motor")
```

`quaero::driver_sdk` es un target *header-only* (solo aporta el directorio de
includes). La versión del paquete sigue la release de Quaero; la compatibilidad
en runtime la decide por separado el check de `DBC_ABI_VERSION` que el cargador
aplica al abrir el plugin.

## Cómo escribir un driver

Guía paso a paso: [`docs/WRITING_A_DRIVER.md`](WRITING_A_DRIVER.md). El punto de
partida es el **driver de plantilla** en
[`examples/driver-template/`](../examples/driver-template/) — el driver mínimo
que satisface esta ABI, sin dependencias externas, listo para copiar. Para una
implementación completa de cada capacidad, mira el driver de referencia de SQLite
en `drivers/sqlite/`.
