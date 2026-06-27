#ifndef DBCORE_IPC_SCHEMA_METHODS_H
#define DBCORE_IPC_SCHEMA_METHODS_H

#include "cJSON.h"

/* Generous cap for an object-tree listing so a pathological catalog cannot dump
   unbounded rows in one response; honest truncation is reported as usual. */
#define IPC_SCHEMA_LIMIT 10000

/*
 * IPC handlers for schema introspection (see docs/IPC.md).
 *
 * schema.tree     params: { connId, db?: string, schema?: string }
 *                 No db -> databases. db only -> schemas (engines with schemas)
 *                 or tables. db+schema or schema -> tables. Returns a result set
 *                 (columns include `name`, and `type` for tables/views).
 * schema.describe params: { connId, table: string } -> column structure.
 * schema.ddl      params: { connId, object: string } -> one-column ("sql") DDL.
 */
cJSON *ipc_method_schema_tree(const cJSON *params, int *code, const char **message);
cJSON *ipc_method_schema_describe(const cJSON *params, int *code, const char **message);
cJSON *ipc_method_schema_ddl(const cJSON *params, int *code, const char **message);

#endif /* DBCORE_IPC_SCHEMA_METHODS_H */
