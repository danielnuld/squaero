#ifndef DBCORE_DRIVER_H
#define DBCORE_DRIVER_H

/*
 * Quaero driver ABI — the vtable contract between libdbcore and a database
 * driver plugin.
 *
 * A driver is a shared library (.dll/.so/.dylib) that exports a single entry
 * point (DBC_DRIVER_ENTRY_SYMBOL) returning a const pointer to a dbc_driver_t.
 * The core loads the plugin, resolves the symbol, validates the ABI version
 * (see dbc_driver_validate) and then operates purely against the vtable — it
 * never knows engine-specific details.
 *
 * This header is the single source of truth for the contract. docs/DRIVER_API.md
 * documents the same surface in prose and MUST stay in sync with it.
 *
 * Stability: a change to the vtable layout (including ADDING members, even at
 * the end), to an enum's existing values, or to the required-member set bumps
 * DBC_ABI_VERSION. The loader validates exact version equality, so a driver
 * built against an older ABI is rejected cleanly rather than read with a
 * mismatched layout. New optional capabilities are appended at the end and
 * gated behind a DBC_FEAT_* flag so the core invokes the member only when the
 * driver advertises it.
 */

/*
 * Result status (dbc_status + the DBC_ERR_* codes) lives in its own minimal
 * header so modules that only report success/failure need not depend on the
 * whole driver ABI. It is re-exported here so this header remains the single
 * include a driver needs.
 */
#include "dbcore/status.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * ABI version of this contract. A driver stamps the value it was built against
 * into dbc_driver_t.abi_version; the core refuses to load a driver whose value
 * does not match (see dbc_driver_validate).
 */
#define DBC_ABI_VERSION 5

/* Canonical name of the exported entry symbol, for the dynamic loader. */
#define DBC_DRIVER_ENTRY_SYMBOL "dbc_driver_entry"

/*
 * Visibility marker a driver puts on its exported entry point so the symbol is
 * resolvable via GetProcAddress/dlsym on every toolchain. Usage:
 *   DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void) { ... }
 */
#if defined(_WIN32)
#  define DBC_DRIVER_EXPORT __declspec(dllexport)
#elif defined(__GNUC__)
#  define DBC_DRIVER_EXPORT __attribute__((visibility("default")))
#else
#  define DBC_DRIVER_EXPORT
#endif

/* Opaque handles owned by the driver; the core only ever holds pointers.
   (dbc_status and the DBC_ERR_* codes come from dbcore/status.h, included above.) */
typedef struct dbc_conn   dbc_conn;
typedef struct dbc_result dbc_result;

/*
 * Neutral column type. The driver maps engine-specific types onto these; the
 * core and frontend never see engine type codes. DBC_TYPE_NULL is the type of
 * a column whose type cannot be determined (it does not mean "the cell is NULL"
 * — a NULL cell is signalled by cell_text returning NULL).
 */
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

/*
 * Capability bitmask (dbc_driver_t.features). A driver advertises a capability
 * ONLY if a working handler backs it; the UI hides features that are absent.
 * Operations that are not advertised must return DBC_ERR_UNSUPPORTED, never a
 * fake empty success.
 */
#define DBC_FEAT_SSL           (1u << 0)  /* TLS/SSL transport */
#define DBC_FEAT_SSH_TUNNEL    (1u << 1)  /* connection via SSH tunnel */
#define DBC_FEAT_TRANSACTIONS  (1u << 2)  /* begin/commit/rollback */
#define DBC_FEAT_SCHEMAS       (1u << 3)  /* engine has schemas within a database */
#define DBC_FEAT_INTROSPECTION (1u << 4)  /* list_* / describe_table */
#define DBC_FEAT_DDL           (1u << 5)  /* get_ddl: CREATE statement of an object */
#define DBC_FEAT_DML           (1u << 6)  /* build_dml: single-row insert/update/delete */

/*
 * Kind of single-row modification requested of build_dml (see below).
 */
typedef enum {
    DBC_DML_INSERT = 0,
    DBC_DML_UPDATE,
    DBC_DML_DELETE
} dbc_dml_kind;

/*
 * A single-row change, expressed neutrally by the core and rendered to engine
 * SQL by the driver's build_dml. Column names and values are plain strings; a
 * NULL value entry means SQL NULL. Values are the textual forms that crossed
 * from the frontend — the driver escapes them as literals and lets the engine
 * coerce them to the column's type.
 *
 *   INSERT: set_cols/set_vals are the columns and values; where_* are unused.
 *   UPDATE: set_cols/set_vals are the assignments; where_cols/where_vals
 *           identify the row (its primary key).
 *   DELETE: where_cols/where_vals identify the row; set_* are unused.
 *
 * set_types (added in ABI 5) carries the neutral column type of each set value so
 * the driver can emit numeric columns UNQUOTED — a value quoted as a string is
 * rejected by some engines (e.g. MySQL rejects '0' for a BIT column). It is
 * parallel to set_cols/set_vals, or NULL when types are unknown (then the driver
 * quotes every value, as before). where_* values are always quoted (a numeric key
 * coerces from its string form on every engine we target).
 */
typedef struct {
    const char        *schema;      /* container (db/schema), NULL = default */
    const char        *table;
    int                n_set;
    const char *const *set_cols;
    const char *const *set_vals;    /* set_vals[i] == NULL => SQL NULL */
    int                n_where;
    const char *const *where_cols;
    const char *const *where_vals;  /* where_vals[i] == NULL => IS NULL */
    const dbc_type    *set_types;   /* neutral type per set value, or NULL (ABI 5) */
} dbc_dml_row;

/*
 * The driver vtable. Layout is ABI; do not reorder members. Required members
 * (checked by dbc_driver_validate) must be non-NULL for every driver. Optional
 * members are gated behind a DBC_FEAT_* flag and may be NULL when the matching
 * capability is not advertised.
 *
 * Memory ownership:
 *   - connect allocates a dbc_conn; disconnect frees it.
 *   - query allocates a dbc_result; free_result frees it.
 *   - All const char* returned by the vtable are owned by the driver and remain
 *     valid until the owning handle is freed (or, for cell_text/col_name, until
 *     the next next_row / free_result call). The core never frees them.
 *
 * Threading: a single dbc_conn is used from one thread at a time; the core
 * serializes access. Distinct connections may be used concurrently.
 */
typedef struct {
    /* --- identity (required) --- */
    int          abi_version;   /* must equal DBC_ABI_VERSION */
    const char  *name;          /* stable id: "sqlite", "postgres", ... */
    const char  *display_name;  /* human label: "SQLite", "PostgreSQL" */

    /* --- connection lifecycle (required) --- */
    dbc_status  (*connect)(const char *dsn_json, dbc_conn **out);
    void        (*disconnect)(dbc_conn *c);
    const char *(*last_error)(dbc_conn *c);  /* last error on c; never NULL */

    /* --- execution (required) --- */
    dbc_status  (*query)(dbc_conn *c, const char *sql, dbc_result **out);
    void        (*free_result)(dbc_result *r);

    /* --- result-set reading (required) --- */
    int          (*col_count)(dbc_result *r);
    const char  *(*col_name)(dbc_result *r, int col);
    dbc_type     (*col_type)(dbc_result *r, int col);
    int          (*next_row)(dbc_result *r);            /* 1 = row ready, 0 = end, <0 = error */
    const char  *(*cell_text)(dbc_result *r, int col);  /* NULL = SQL NULL */
    long long    (*rows_affected)(dbc_result *r);

    /*
     * --- introspection (optional; DBC_FEAT_INTROSPECTION) ---
     * `schema` names the container the object lives in (a database/schema, per
     * the engine). It mirrors list_tables' `schema` so describe_table/get_ddl
     * can reach objects outside the connection's default database; NULL means
     * the engine default. (Added the `schema` arg to describe_table in ABI 3.)
     */
    dbc_status  (*list_databases)(dbc_conn *c, dbc_result **out);
    dbc_status  (*list_schemas)(dbc_conn *c, const char *db, dbc_result **out);
    dbc_status  (*list_tables)(dbc_conn *c, const char *schema, dbc_result **out);
    dbc_status  (*describe_table)(dbc_conn *c, const char *schema, const char *table, dbc_result **out);

    /* --- transactions (optional; DBC_FEAT_TRANSACTIONS) --- */
    dbc_status  (*begin)(dbc_conn *c);
    dbc_status  (*commit)(dbc_conn *c);
    dbc_status  (*rollback)(dbc_conn *c);

    /* --- capabilities --- */
    unsigned int features;  /* OR of DBC_FEAT_* */

    /*
     * --- DDL generation (optional; DBC_FEAT_DDL) ---
     * Added in ABI 2; gained the `schema` argument in ABI 3 (NULL = engine
     * default). Returns the CREATE statement of `object` (table/view/...) as a
     * one-column ("sql") result set, or DBC_ERR_UNSUPPORTED when not implemented.
     */
    dbc_status  (*get_ddl)(dbc_conn *c, const char *schema, const char *object, dbc_result **out);

    /*
     * --- data modification (optional; DBC_FEAT_DML; added in ABI 4) ---
     * Build the literal SQL statement that applies `row` (an insert, update or
     * delete of a single row — see dbc_dml_kind). Returns it as a one-column
     * ("sql") result set, exactly like get_ddl, so the core can preview the
     * statement and/or execute it through the normal query path. The driver
     * quotes identifiers and inlines values as properly escaped literals.
     * Returns DBC_ERR_UNSUPPORTED when the engine does not implement editing.
     */
    dbc_status  (*build_dml)(dbc_conn *c, dbc_dml_kind kind, const dbc_dml_row *row, dbc_result **out);
} dbc_driver_t;

/* Type of the exported entry point. Returns the driver's static vtable. */
typedef const dbc_driver_t *(*dbc_driver_entry_fn)(void);

/*
 * Entry point every driver must export under DBC_DRIVER_ENTRY_SYMBOL. The
 * returned vtable is owned by the driver (typically static storage) and lives
 * for the lifetime of the loaded library. The core verifies abi_version before
 * use; see dbc_driver_validate.
 *
 * The declaration carries DBC_DRIVER_EXPORT so it agrees in linkage with the
 * driver's definition (MSVC rejects a plain prototype followed by a dllexport
 * definition). In the core — which only ever resolves this symbol dynamically
 * and never defines it — the marker has no effect.
 */
DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void);

/*
 * Validate a vtable returned by a driver before the core uses it. Checks the
 * ABI version and that all required members are present. This is the load-time
 * gate the dynamic loader applies to every plugin.
 *
 * Returns:
 *   DBC_OK           - drv is usable.
 *   DBC_ERR_PARAM    - drv is NULL.
 *   DBC_ERR_ABI      - drv->abi_version != DBC_ABI_VERSION.
 *   DBC_ERR_UNSUPPORTED - a required member (name/display_name or a required
 *                         function pointer) is missing.
 */
dbc_status dbc_driver_validate(const dbc_driver_t *drv);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_DRIVER_H */
