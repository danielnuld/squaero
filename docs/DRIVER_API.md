# Contrato de drivers (vtable)

Un driver es una biblioteca compartida (`.dll`/`.so`/`.dylib`) que exporta una función de entrada conocida y devuelve una **tabla de funciones** (vtable). El núcleo carga el plugin con `LoadLibrary`/`dlopen`, resuelve el símbolo de entrada y opera contra la vtable sin conocer detalles del motor.

> **Fuente de verdad:** la definición canónica vive en
> [`core/include/dbcore/driver.h`](../core/include/dbcore/driver.h). Este
> documento describe el mismo contrato en prosa y **debe mantenerse
> sincronizado** con el header. Ante cualquier discrepancia, el header manda.

ABI actual: **`DBC_ABI_VERSION = 1`**.

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
#define DBC_ABI_VERSION 1
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

**Disciplina de ABI:** cambiar el layout de la vtable, los valores existentes de
un enum, o el conjunto de miembros obligatorios es una **ruptura de ABI** y
obliga a subir `DBC_ABI_VERSION`. Agregar capacidades opcionales **al final** de
la struct, protegidas por un flag `DBC_FEAT_*`, es un cambio compatible.

## Tipos de estado y de dato

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
    dbc_status  (*describe_table)(dbc_conn *c, const char *table, dbc_result **out);

    /* --- transacciones (opcional; DBC_FEAT_TRANSACTIONS) --- */
    dbc_status  (*begin)(dbc_conn *c);
    dbc_status  (*commit)(dbc_conn *c);
    dbc_status  (*rollback)(dbc_conn *c);

    /* --- capacidades --- */
    unsigned int features;   /* OR de DBC_FEAT_* */
} dbc_driver_t;
```

Los miembros **obligatorios** (identidad, ciclo de vida, ejecución y lectura del
result set) deben ser no-`NULL` en todo driver y los verifica
`dbc_driver_validate`. Los miembros **opcionales** (introspección, transacciones)
pueden ser `NULL` cuando la capacidad correspondiente no se advierte en
`features`.

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

## Cómo escribir un driver

Plantilla y guía paso a paso en el milestone **M8**. La idea: copiar el driver de
SQLite (referencia mínima), implementar la vtable contra la librería cliente del
motor, compilar como biblioteca compartida y colocarla en el directorio de
plugins.
