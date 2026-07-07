#include "mcp_server.h"

#include "stmt_class.h"

#include "dbcore/ipc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Local alias so the internal helpers can spell the type without `struct` or
   the public `_t` suffix. */
typedef struct mcp_server mcp_server;

/* MCP protocol revision we implement (date-based, per the spec). */
#define MCP_PROTOCOL_VERSION "2024-11-05"
/* Row cap applied to query_run when the caller does not specify one, to keep
   tool payloads small for the model. Callers may request a larger limit. */
#define MCP_DEFAULT_LIMIT 200

typedef struct {
    const mcp_conn_t *rec;
    int open;
    char conn_id[32];
} conn_slot;

struct mcp_server {
    mcp_conns_t *conns; /* borrowed */
    char name[64];
    char version[32];
    conn_slot *slots;
    size_t nslots;
};

/* ---- small JSON helpers -------------------------------------------------- */

static char *print_and_free(cJSON *doc)
{
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s; /* caller frees with free() */
}

/* Response envelope with a `result`. `result` ownership is transferred. */
static char *response_result(const cJSON *id, cJSON *result)
{
    cJSON *resp = cJSON_CreateObject();
    if (resp == NULL) {
        cJSON_Delete(result);
        return NULL;
    }
    cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
    cJSON_AddItemToObject(resp, "id",
                          id != NULL ? cJSON_Duplicate(id, 1) : cJSON_CreateNull());
    cJSON_AddItemToObject(resp, "result", result);
    return print_and_free(resp);
}

static char *response_error(const cJSON *id, int code, const char *message)
{
    cJSON *resp = cJSON_CreateObject();
    if (resp == NULL) {
        return NULL;
    }
    cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
    cJSON_AddItemToObject(resp, "id",
                          id != NULL ? cJSON_Duplicate(id, 1) : cJSON_CreateNull());
    cJSON *err = cJSON_AddObjectToObject(resp, "error");
    cJSON_AddNumberToObject(err, "code", code);
    cJSON_AddStringToObject(err, "message", message);
    return print_and_free(resp);
}

/* An MCP tool result: { content: [ { type:"text", text } ], isError? }. */
static cJSON *tool_text(const char *text, int is_error)
{
    cJSON *result = cJSON_CreateObject();
    cJSON *content = cJSON_AddArrayToObject(result, "content");
    cJSON *item = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "type", "text");
    cJSON_AddStringToObject(item, "text", text);
    cJSON_AddItemToArray(content, item);
    if (is_error) {
        cJSON_AddBoolToObject(result, "isError", 1);
    }
    return result;
}

/* Serialize a core result payload as the text of a tool result. Consumes
   `payload`. */
static cJSON *tool_json(cJSON *payload)
{
    char *text = cJSON_PrintUnformatted(payload);
    cJSON_Delete(payload);
    if (text == NULL) {
        return tool_text("out of memory", 1);
    }
    cJSON *result = tool_text(text, 0);
    free(text);
    return result;
}

/* ---- core bridge --------------------------------------------------------- */

/* Call a core JSON-RPC method. On success returns the detached `result` node
   (caller owns); on failure returns NULL and fills `err`. Consumes `params`. */
static cJSON *call_core(const char *method, cJSON *params, char *err,
                        size_t errlen)
{
    cJSON *req = cJSON_CreateObject();
    if (req == NULL) {
        cJSON_Delete(params);
        snprintf(err, errlen, "out of memory");
        return NULL;
    }
    cJSON_AddStringToObject(req, "jsonrpc", "2.0");
    cJSON_AddNumberToObject(req, "id", 1);
    cJSON_AddStringToObject(req, "method", method);
    if (params != NULL) {
        cJSON_AddItemToObject(req, "params", params);
    }
    char *reqstr = cJSON_PrintUnformatted(req);
    cJSON_Delete(req);
    if (reqstr == NULL) {
        snprintf(err, errlen, "out of memory");
        return NULL;
    }
    char *respstr = dbcore_ipc_handle(reqstr);
    free(reqstr);
    if (respstr == NULL) {
        snprintf(err, errlen, "core returned no response");
        return NULL;
    }
    cJSON *resp = cJSON_Parse(respstr);
    dbcore_ipc_free(respstr);
    if (resp == NULL) {
        snprintf(err, errlen, "core response parse error");
        return NULL;
    }
    cJSON *result = cJSON_DetachItemFromObjectCaseSensitive(resp, "result");
    if (result != NULL) {
        cJSON_Delete(resp);
        return result;
    }
    const cJSON *e = cJSON_GetObjectItemCaseSensitive(resp, "error");
    const cJSON *m =
        e != NULL ? cJSON_GetObjectItemCaseSensitive(e, "message") : NULL;
    snprintf(err, errlen, "%s",
             (cJSON_IsString(m) && m->valuestring != NULL) ? m->valuestring
                                                           : "core error");
    cJSON_Delete(resp);
    return NULL;
}

/* Lazily open the connection for `rec`, returning its cached connId. NULL on
   failure with `err` filled. */
static const char *ensure_open(mcp_server *s, const mcp_conn_t *rec, char *err,
                               size_t errlen)
{
    conn_slot *slot = NULL;
    for (size_t i = 0; i < s->nslots; i++) {
        if (s->slots[i].rec == rec) {
            slot = &s->slots[i];
            break;
        }
    }
    if (slot == NULL) {
        snprintf(err, errlen, "connection not registered");
        return NULL;
    }
    if (slot->open) {
        return slot->conn_id;
    }
    cJSON *params = cJSON_CreateObject();
    cJSON_AddStringToObject(params, "driver", rec->driver);
    cJSON_AddItemToObject(params, "dsn", cJSON_Duplicate(rec->params, 1));
    cJSON *result = call_core("conn.open", params, err, errlen);
    if (result == NULL) {
        return NULL;
    }
    const cJSON *cid = cJSON_GetObjectItemCaseSensitive(result, "connId");
    if (!cJSON_IsString(cid) || cid->valuestring == NULL) {
        cJSON_Delete(result);
        snprintf(err, errlen, "core did not return a connId");
        return NULL;
    }
    snprintf(slot->conn_id, sizeof slot->conn_id, "%s", cid->valuestring);
    slot->open = 1;
    cJSON_Delete(result);
    return slot->conn_id;
}

/* Resolve the required "connection" argument to an opted-in record. */
static const mcp_conn_t *resolve_conn(mcp_server *s, const cJSON *args,
                                      const char **why)
{
    const cJSON *c = cJSON_GetObjectItemCaseSensitive(args, "connection");
    if (!cJSON_IsString(c) || c->valuestring == NULL) {
        *why = "argument \"connection\" (string) is required";
        return NULL;
    }
    const mcp_conn_t *rec = mcp_conns_find(s->conns, c->valuestring);
    if (rec == NULL) {
        *why = "unknown connection (not found or not enabled for MCP)";
        return NULL;
    }
    return rec;
}

/* Copy an optional string argument onto a params object under `key`. */
static void copy_opt_str(cJSON *params, const cJSON *args, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(args, key);
    if (cJSON_IsString(v) && v->valuestring != NULL) {
        cJSON_AddStringToObject(params, key, v->valuestring);
    }
}

/* ---- tools --------------------------------------------------------------- */

static cJSON *tool_list_connections(mcp_server *s)
{
    cJSON *arr = cJSON_CreateArray();
    for (size_t i = 0; i < mcp_conns_count(s->conns); i++) {
        const mcp_conn_t *r = mcp_conns_at(s->conns, i);
        cJSON *o = cJSON_CreateObject();
        if (r->id != NULL) {
            cJSON_AddStringToObject(o, "id", r->id);
        }
        if (r->name != NULL) {
            cJSON_AddStringToObject(o, "name", r->name);
        }
        cJSON_AddStringToObject(o, "driver", r->driver);
        cJSON_AddBoolToObject(o, "readOnly", !r->allow_write);
        cJSON_AddItemToArray(arr, o);
    }
    return tool_json(arr); /* never leaks credentials: only id/name/driver */
}

static cJSON *tool_schema_tree(mcp_server *s, const cJSON *args)
{
    const char *why = NULL;
    const mcp_conn_t *rec = resolve_conn(s, args, &why);
    if (rec == NULL) {
        return tool_text(why, 1);
    }
    char err[256];
    const char *conn_id = ensure_open(s, rec, err, sizeof err);
    if (conn_id == NULL) {
        return tool_text(err, 1);
    }
    cJSON *params = cJSON_CreateObject();
    cJSON_AddStringToObject(params, "connId", conn_id);
    copy_opt_str(params, args, "db");
    copy_opt_str(params, args, "schema");
    cJSON *result = call_core("schema.tree", params, err, sizeof err);
    return result != NULL ? tool_json(result) : tool_text(err, 1);
}

static cJSON *tool_schema_describe(mcp_server *s, const cJSON *args)
{
    const char *why = NULL;
    const mcp_conn_t *rec = resolve_conn(s, args, &why);
    if (rec == NULL) {
        return tool_text(why, 1);
    }
    const cJSON *table = cJSON_GetObjectItemCaseSensitive(args, "table");
    if (!cJSON_IsString(table) || table->valuestring == NULL) {
        return tool_text("argument \"table\" (string) is required", 1);
    }
    char err[256];
    const char *conn_id = ensure_open(s, rec, err, sizeof err);
    if (conn_id == NULL) {
        return tool_text(err, 1);
    }
    cJSON *params = cJSON_CreateObject();
    cJSON_AddStringToObject(params, "connId", conn_id);
    cJSON_AddStringToObject(params, "table", table->valuestring);
    copy_opt_str(params, args, "schema");
    copy_opt_str(params, args, "db");
    cJSON *result = call_core("schema.describe", params, err, sizeof err);
    return result != NULL ? tool_json(result) : tool_text(err, 1);
}

static cJSON *tool_query_run(mcp_server *s, const cJSON *args)
{
    const char *why = NULL;
    const mcp_conn_t *rec = resolve_conn(s, args, &why);
    if (rec == NULL) {
        return tool_text(why, 1);
    }
    const cJSON *sql = cJSON_GetObjectItemCaseSensitive(args, "sql");
    if (!cJSON_IsString(sql) || sql->valuestring == NULL) {
        return tool_text("argument \"sql\" (string) is required", 1);
    }
    /* Security gate: on a read-only connection, refuse anything the classifier
       cannot prove read-only. */
    if (!rec->allow_write && stmt_classify(sql->valuestring) == STMT_WRITE) {
        return tool_text("refused: connection is read-only for MCP; the "
                         "statement is not a read (SELECT/WITH.../EXPLAIN/SHOW). "
                         "Enable \"mcpWrite\" on this connection to allow writes.",
                         1);
    }
    char err[256];
    const char *conn_id = ensure_open(s, rec, err, sizeof err);
    if (conn_id == NULL) {
        return tool_text(err, 1);
    }
    cJSON *params = cJSON_CreateObject();
    cJSON_AddStringToObject(params, "connId", conn_id);
    cJSON_AddStringToObject(params, "sql", sql->valuestring);
    const cJSON *limit = cJSON_GetObjectItemCaseSensitive(args, "limit");
    if (cJSON_IsNumber(limit) && limit->valuedouble == (double)limit->valueint &&
        limit->valueint >= 1) {
        cJSON_AddNumberToObject(params, "limit", limit->valueint);
    } else {
        cJSON_AddNumberToObject(params, "limit", MCP_DEFAULT_LIMIT);
    }
    cJSON *result = call_core("query.run", params, err, sizeof err);
    return result != NULL ? tool_json(result) : tool_text(err, 1);
}

/* ---- protocol methods ---------------------------------------------------- */

static void add_tool(cJSON *tools, const char *name, const char *desc,
                     cJSON *schema)
{
    cJSON *t = cJSON_CreateObject();
    cJSON_AddStringToObject(t, "name", name);
    cJSON_AddStringToObject(t, "description", desc);
    cJSON_AddItemToObject(t, "inputSchema", schema);
    cJSON_AddItemToArray(tools, t);
}

/* JSON Schema object with `props` already built; marks `required` names. */
static cJSON *schema_object(cJSON *props, const char *const *required,
                            size_t nreq)
{
    cJSON *s = cJSON_CreateObject();
    cJSON_AddStringToObject(s, "type", "object");
    cJSON_AddItemToObject(s, "properties", props);
    if (nreq > 0) {
        cJSON *req = cJSON_AddArrayToObject(s, "required");
        for (size_t i = 0; i < nreq; i++) {
            cJSON_AddItemToArray(req, cJSON_CreateString(required[i]));
        }
    }
    return s;
}

static cJSON *str_prop(const char *desc)
{
    cJSON *p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "type", "string");
    cJSON_AddStringToObject(p, "description", desc);
    return p;
}

static cJSON *build_tools_list(void)
{
    cJSON *tools = cJSON_CreateArray();

    add_tool(tools, "list_connections",
             "List the database connections enabled for MCP (id, name, driver, "
             "readOnly). No credentials are ever returned.",
             schema_object(cJSON_CreateObject(), NULL, 0));

    {
        cJSON *p = cJSON_CreateObject();
        cJSON_AddItemToObject(p, "connection",
                              str_prop("Connection id or name (from list_connections)."));
        cJSON_AddItemToObject(p, "db", str_prop("Optional database to scope to."));
        cJSON_AddItemToObject(p, "schema", str_prop("Optional schema to scope to."));
        const char *req[] = {"connection"};
        add_tool(tools, "schema_tree",
                 "Browse the object tree (databases/schemas/tables/views) of a "
                 "connection.",
                 schema_object(p, req, 1));
    }
    {
        cJSON *p = cJSON_CreateObject();
        cJSON_AddItemToObject(p, "connection", str_prop("Connection id or name."));
        cJSON_AddItemToObject(p, "table", str_prop("Table or view name to describe."));
        cJSON_AddItemToObject(p, "schema", str_prop("Optional schema/database qualifier."));
        const char *req[] = {"connection", "table"};
        add_tool(tools, "schema_describe",
                 "Describe a table/view: columns, types, nullability, primary key.",
                 schema_object(p, req, 2));
    }
    {
        cJSON *p = cJSON_CreateObject();
        cJSON_AddItemToObject(p, "connection", str_prop("Connection id or name."));
        cJSON_AddItemToObject(p, "sql", str_prop("SQL to run. Read-only unless the connection allows writes."));
        cJSON *lim = cJSON_CreateObject();
        cJSON_AddStringToObject(lim, "type", "integer");
        cJSON_AddStringToObject(lim, "description", "Max rows to return (default 200).");
        cJSON_AddItemToObject(p, "limit", lim);
        const char *req[] = {"connection", "sql"};
        add_tool(tools, "query_run",
                 "Run a SQL query and return rows. On read-only connections only "
                 "SELECT/WITH.../EXPLAIN/SHOW are permitted; writes are refused.",
                 schema_object(p, req, 2));
    }
    return tools;
}

static cJSON *handle_initialize(mcp_server *s)
{
    cJSON *result = cJSON_CreateObject();
    cJSON_AddStringToObject(result, "protocolVersion", MCP_PROTOCOL_VERSION);
    cJSON *caps = cJSON_AddObjectToObject(result, "capabilities");
    cJSON_AddItemToObject(caps, "tools", cJSON_CreateObject());
    cJSON *info = cJSON_AddObjectToObject(result, "serverInfo");
    cJSON_AddStringToObject(info, "name", s->name);
    cJSON_AddStringToObject(info, "version", s->version);
    return result;
}

static cJSON *handle_tools_call(mcp_server *s, const cJSON *params)
{
    const cJSON *name = cJSON_GetObjectItemCaseSensitive(params, "name");
    if (!cJSON_IsString(name) || name->valuestring == NULL) {
        return tool_text("tools/call requires a tool name", 1);
    }
    const cJSON *args = cJSON_GetObjectItemCaseSensitive(params, "arguments");
    if (args != NULL && !cJSON_IsObject(args)) {
        return tool_text("tools/call \"arguments\" must be an object", 1);
    }
    cJSON *empty = NULL;
    if (args == NULL) {
        empty = cJSON_CreateObject();
        args = empty;
    }
    cJSON *result;
    if (strcmp(name->valuestring, "list_connections") == 0) {
        result = tool_list_connections(s);
    } else if (strcmp(name->valuestring, "schema_tree") == 0) {
        result = tool_schema_tree(s, args);
    } else if (strcmp(name->valuestring, "schema_describe") == 0) {
        result = tool_schema_describe(s, args);
    } else if (strcmp(name->valuestring, "query_run") == 0) {
        result = tool_query_run(s, args);
    } else {
        result = tool_text("unknown tool", 1);
    }
    cJSON_Delete(empty);
    return result;
}

/* ---- lifecycle + dispatch ------------------------------------------------ */

mcp_server *mcp_server_new(mcp_conns_t *conns)
{
    mcp_server *s = (mcp_server *)calloc(1, sizeof *s);
    if (s == NULL) {
        return NULL;
    }
    s->conns = conns;
    snprintf(s->name, sizeof s->name, "%s", "quaero");
    snprintf(s->version, sizeof s->version, "%s", "0");
    s->nslots = mcp_conns_count(conns);
    if (s->nslots > 0) {
        s->slots = (conn_slot *)calloc(s->nslots, sizeof *s->slots);
        if (s->slots == NULL) {
            free(s);
            return NULL;
        }
        for (size_t i = 0; i < s->nslots; i++) {
            s->slots[i].rec = mcp_conns_at(conns, i);
        }
    }
    return s;
}

void mcp_server_set_info(mcp_server *s, const char *name, const char *version)
{
    if (name != NULL) {
        snprintf(s->name, sizeof s->name, "%s", name);
    }
    if (version != NULL) {
        snprintf(s->version, sizeof s->version, "%s", version);
    }
}

char *mcp_server_handle(mcp_server *s, const char *request_json)
{
    cJSON *root = cJSON_Parse(request_json);
    if (root == NULL) {
        return response_error(NULL, -32700, "parse error");
    }
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "id");
    const cJSON *method = cJSON_GetObjectItemCaseSensitive(root, "method");
    const cJSON *params = cJSON_GetObjectItemCaseSensitive(root, "params");

    /* A request without an id is a notification: act on it, never reply. */
    int is_notification = (id == NULL);

    if (!cJSON_IsString(method) || method->valuestring == NULL) {
        char *out = is_notification ? NULL
                                    : response_error(id, -32600, "invalid request");
        cJSON_Delete(root);
        return out;
    }

    char *out = NULL;
    const char *m = method->valuestring;
    if (strcmp(m, "initialize") == 0) {
        out = response_result(id, handle_initialize(s));
    } else if (strcmp(m, "ping") == 0) {
        out = response_result(id, cJSON_CreateObject());
    } else if (strcmp(m, "tools/list") == 0) {
        cJSON *result = cJSON_CreateObject();
        cJSON_AddItemToObject(result, "tools", build_tools_list());
        out = response_result(id, result);
    } else if (strcmp(m, "tools/call") == 0) {
        out = response_result(id, handle_tools_call(s, params));
    } else if (strncmp(m, "notifications/", 14) == 0) {
        out = NULL; /* client notification; nothing to do, no reply */
    } else if (!is_notification) {
        out = response_error(id, -32601, "method not found");
    }

    cJSON_Delete(root);
    return out;
}

void mcp_server_free(mcp_server *s)
{
    if (s == NULL) {
        return;
    }
    free(s->slots);
    free(s);
}
