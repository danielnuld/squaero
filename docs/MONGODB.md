# MongoDB document result model

MongoDB is a document store: a collection holds heterogeneous BSON documents
with no fixed schema. Squaero's result model (`docs/DRIVER_API.md`,
`core/include/dbcore/result.h`) is tabular — columns with a neutral type, cells
as text. This note records how documents are mapped onto that model (issue #71)
and why **no core/vtable/IPC change is required**.

## Decision: flatten top-level fields into columns

Each document on the returned page becomes one **row**. Its **top-level fields**
become **columns**; the column set of a result is the union of the top-level
field names across the page:

- `_id` is always the first column.
- Every other field keeps first-seen order across the scanned documents.
- A field a given document does not have is **SQL NULL** in that row (distinct
  from an empty value).
- A field whose value is a **nested document or array** is exchanged as a single
  **JSON cell** (`DBC_TYPE_JSON`) holding its canonical Extended-JSON form —
  nested structure is not exploded into further columns.

Scalar BSON types map to the neutral types via
`mongo_bson_type_to_neutral` (`drivers/mongodb/src/utils/bson_types.c`): int32/
int64 → INT, double/decimal128 → FLOAT, bool → BOOL, UTC datetime and the
internal timestamp → TIMESTAMP, binary → BLOB, ObjectId/regex/code/string →
TEXT, embedded document/array → JSON.

Because a collection is schemaless, a field's neutral type is inferred **per
value while flattening**, not from a fixed column schema. A field that is a
number in one document and a string in another simply carries whatever type its
value has in each row; every cell crosses to the frontend as text, so a
mixed-type field is still exchanged losslessly.

### Why flatten rather than a single JSON column

A one-column "document" result (each row a whole document as JSON) was the
simpler alternative. Flattening was chosen because Squaero's UI is a tabular
grid: users expect `name`, `age`, `city` as sortable columns, and the object
tree / `describe_table` view can present a collection's inferred fields as
"columns". Nested structure that has no scalar shape still degrades gracefully
to a JSON cell, so ragged documents are handled without exploding the grid.

## Query language

Squaero's query channel hands a driver one command string. For MongoDB the user
writes a **mongosh-style** expression:

```
db.<collection>.find(<filter?>, <projection?>)[.sort(<doc>)][.skip(<n>)][.limit(<n>)]
db.<collection>.findOne(<filter?>, <projection?>)
db.<collection>.aggregate(<pipeline-array>)
db.<collection>.countDocuments(<filter?>)       db.<collection>.distinct("<field>", <filter?>)
db.<collection>.insertOne(<doc>)                db.<collection>.insertMany(<docs-array>)
db.<collection>.updateOne(<filter>, <update>, <opts?>)   (updateMany: same; <update> may be a pipeline)
db.<collection>.replaceOne(<filter>, <doc>, <opts?>)
db.<collection>.deleteOne(<filter>)             db.<collection>.deleteMany(<filter>)
db.<collection>.createIndex(<keys>, <opts?>)    db.<collection>.dropIndex(<name | keys>)
db.<collection>.getIndexes()                    db.<collection>.drop()
db.createCollection("<name>", <opts?>)          db.createView("<name>", "<source>", <pipeline>, <opts?>)
db.runCommand(<doc | "name">)
db.<collection>.renameCollection("<new>", <dropTarget?>)
db.<collection>.find(...)[...].explain(<verbosity?>)      db.<collection>.aggregate([...]).explain(<verbosity?>)
db.currentOp(<filter?>)                         db.killOp(<opid>)
db.setProfilingLevel(<0|1|2>, <slowms | opts?>)  db.getProfilingStatus()
db.getCollectionInfos(<filter?>, <opts?>)
db.getCollection("<name>").<method>(...)        (addresses any collection name)
```

- `find` runs `mongoc_collection_find_with_opts`; the optional second argument is
  a projection, and `.sort()`/`.skip()`/`.limit()` chain onto it. `findOne` is a
  `find` of one document (no chaining).
- `aggregate` runs `mongoc_collection_aggregate` over the pipeline array.
- **Writes and utility commands** return a result set shaped like mongosh's
  acknowledgement, flattened by the same code as find results: `insertOne` ->
  `acknowledged`, `insertedId`; `insertMany` -> `acknowledged`, `insertedCount`,
  `insertedIds`; `updateOne`/`updateMany`/`replaceOne` -> `acknowledged`,
  `matchedCount`, `modifiedCount`, `upsertedCount`[, `upsertedId`]; `deleteOne`/
  `deleteMany` -> `acknowledged`, `deletedCount`; `countDocuments` -> `count`;
  `distinct` -> one `value` row per distinct value; `createIndex` -> `name` (+ the
  server's counts); `runCommand` -> the reply document. **`rows_affected`** is the
  real server count: inserted documents, the documents *matched* by an update or
  replace (plus an upserted one; `modifiedCount` tells how many actually changed,
  the "changed" of MySQL), deleted documents, and the reply's `n` for
  `runCommand`. Commands that change no documents report 0. A server error
  (duplicate key, validation failure, a bad update operator) is a query error
  carrying the server's message.
- An unbounded `find` (no `.limit()`) is capped at a safety bound
  (`MONGO_SCAN_CAP`, 10000) so it cannot exhaust memory; the core's own row cap
  and truncation flag apply on top.

The argument documents accept the **relaxed** JavaScript-object form the mongo
shell uses — bare (unquoted) keys, single-quoted strings and the value
constructors `ObjectId("...")`, `ISODate("...")` / `new Date("...")`,
`NumberLong(...)`, `NumberInt(...)` and `NumberDecimal("...")`, e.g.
`db.users.find({ age: { $gt: 25 } })`. A pure normalizer
(`utils/json_relax.c`) rewrites them to strict Extended JSON before handing them to
libbson; already-valid JSON passes through unchanged. The command *shape* is
parsed by a pure module (`utils/query_parse.c`); neither depends on libbson, so
both are unit-tested without a MongoDB client. An unknown method (`bulkWrite`,
`findOneAndUpdate`, `remove`, ...) is rejected as **unsupported**
(`DBC_ERR_UNSUPPORTED`, JSON-RPC `-32001`) with a message naming it, rather than
faked; a malformed command is an ordinary query error. Not covered yet:
`bulkWrite`, `findOneAndUpdate/Replace/Delete`, `estimatedDocumentCount`, cursor
modifiers other than `sort/skip/limit`, `runCommand` options, JavaScript
expressions and variables.

## Editing documents from the grid (`DBC_FEAT_DML`)

`describe_table` reports `_id` as the primary key, so a collection opened from the
tree is editable. `build_dml` (`utils/dml.c`, pure) renders the grid's change as a
mongosh statement that the driver runs through the same command path:

```
db.users.insertOne({"name": "ana", "age": 30})
db.users.updateOne({"$or": [{"_id": {"$oid": "..."}}, {"_id": "..."}]}, {"$set": {"age": 31}})
db.users.deleteOne({"$or": [{"_id": 7}, {"_id": "7"}]})
```

- The cell text does not say which BSON type `_id` has, so the filter matches every
  type the text can stand for (24 hex digits -> ObjectId or string, an integer ->
  number or string, an ISO date -> date or string; each branch uses the `_id`
  index).
- Values are typed from the neutral column type: INT/FLOAT/BOOL unquoted (a value
  that does not fit its type is kept as a string — the collection is schemaless),
  JSON cells parsed and validated (an invalid one is refused; it can never break
  out of the statement), DATE/TIMESTAMP as `{"$date": ...}`, everything else a
  string. With no types the value is inferred conservatively (number,
  `true`/`false`, JSON document/array, else string). A NULL is `null` in an update;
  in an insert a NULL cell (or an empty `_id`) is left out so the server applies its
  defaults. `_id` is never `$set`.
- A collection name that is not a plain identifier goes through
  `db.getCollection("...")`. Statements run against the connected database, so
  editing another database's collection is refused (`DBC_ERR_UNSUPPORTED`).
- **Transactions depend on the server.** On a replica set or a sharded cluster the
  edit session runs inside a multi-document transaction (below). On a standalone
  `mongod` `tx.begin` answers unsupported and the frontend's edit session applies each
  change as it runs (nothing to commit or roll back). If one fails midway, the ones
  before it stay applied and the session ends with a message saying so.
- Limitations: an ObjectId-valued field *other than* `_id` is shown as text and is
  written back as a string if the user edits it (use `ObjectId("...")` in the
  editor for that); binary cells are not editable as binary; int32/int64 and
  double/decimal128 are not told apart on edit beyond "an integer-looking value of
  a float column stays a double".

## Collection definition (`DBC_FEAT_DDL`)

`get_ddl` returns a reproducible mongosh script as the usual one-column `sql`
result: the `createCollection` options (capped, validator, collation, timeseries,
...) from `listCollections` and one `createIndex` per secondary index from
`listIndexes`, sorted by index name so the output is deterministic; the default
`_id_` index is left out (the server creates it). A view is a single
`db.createView(...)`. The pure assembly is `utils/ddl.c`; fetching the pieces is
`src/ddl.c`.

```
db.createCollection("orders", { "validator" : { "$jsonSchema" : { "required" : [ "sku" ] } }, "validationLevel" : "moderate" });
db.orders.createIndex({ "sku" : 1 }, { "name": "sku_1", "unique" : true });
```

The script runs in Squaero's own editor as well as in mongosh. A text index is
rebuilt from its `weights` (`{ "t" : "text" }`).

## Transactions (`DBC_FEAT_TRANSACTIONS`)

`tx.begin` / `tx.commit` / `tx.rollback` are multi-document transactions over a mongoc
client session (`txn.c`). The capability flag is static but the capability is the
server's, so `begin` checks the topology it is really connected to
(`utils/tx_support.c`): a replica-set primary (4.0+) or a mongos (4.2+) can; a
standalone `mongod`, a secondary or an older server cannot, and `begin` fails with
`DBC_ERR_UNSUPPORTED` (JSON-RPC `-32001`) and the reason, e.g. *"transactions need a
replica set or a sharded cluster: this MongoDB server is standalone"*. The frontend's
edit session (`txBeginIfSupported`) treats that exactly like an engine without
transactions and applies each change as it runs.

While a transaction is open every operation joins it (the session is passed in the
options of `find`, `aggregate`, the writes, `countDocuments`, `distinct`,
`createIndex`/`dropIndex`, `drop`, `createCollection`/`createView` and `runCommand`);
`getIndexes`, `explain` and the server commands of the monitor/profiler run outside it
because the server does not allow them inside. Other connections see nothing until
`commit`; `rollback` discards. A second `begin` inside a transaction, or a
`commit`/`rollback` with none open, is an error. A failed operation aborts the
transaction on the server; the following `rollback` still succeeds (mongoc logs a
harmless *"Error in abortTransaction ... has been aborted"* warning to stderr).
Disconnecting with a transaction open abandons it. The index manager does not use a
transaction on MongoDB (an index cannot be built inside one).

## Execution plan

`db.coll.find(...).sort(...).limit(n).explain()` and `db.coll.aggregate([...]).explain()`
run the `explain` command and return its reply as one row (`queryPlanner`,
`executionStats` when asked for, `serverInfo`... as JSON cells). The verbosity is
`"queryPlanner"` (default; does not run the query), `"executionStats"` or
`"allPlansExecution"`. `.explain()` must be the last call; `findOne` has none. The
frontend's visual plan (`Plan` button, slow-queries *EXPLAIN*) appends
`.explain("queryPlanner")` to the statement and draws the stage tree of the winning
plan (`FETCH` over `IXSCAN`, `OR` with several inputs, one branch per shard, the
slot-based engine's `queryPlan`, an aggregation as a chain ending in the `$cursor`);
with `executionStats` the nodes carry rows returned and time.

## Operations monitor and slow queries

- `db.currentOp(filter?)` runs `$currentOp` on `admin` and returns one row per
  operation (`opid`, `op`, `ns`, `secs_running`, `command` as JSON...). The filter
  document is a `$match` on those rows; `{$ownOps: true}` limits the list to the
  caller's operations (the form a user without the `inprog` privilege may run) and
  `{$all: true}` adds idle connections. `db.killOp(opid)` kills one (an integer, or the
  `"<shard>:<n>"` string of a sharded cluster). The server monitor lists
  `db.currentOp()` and kills the selected row with `db.killOp(<opid>)`.
- The **server's own refusal is the answer**: without `inprog`/`killop` the user sees
  *"not authorized on admin..."*, never an empty list.
- Slow queries come from the profiler: `db.setProfilingLevel(level, slowms | opts)`
  (`0` off, `1` slow operations, `2` all) and `db.getProfilingStatus()` set and read it,
  and `db.system.profile.find(...)` reads what it recorded. The slow-queries tool runs
  an aggregation over `system.profile` that groups by collection, operation and query
  shape (`queryHash`) with executions, average, total and maximum milliseconds, and
  rebuilds a `find`/`aggregate`/`count`/`distinct` statement from the profiled command so
  *Open* and *EXPLAIN* work on it (writes are listed but not reopened). With the
  profiler off the list is empty and the panel says how to turn it on. There is no reset
  button: `system.profile` can only be dropped once profiling is off, which is two
  commands.

## Collections, views and indexes from the tree

`list_tables` tells views from collections (`listCollections`), so the tree shows a view
as a view. `db.getCollectionInfos(filter?)` lists name/type/options (the object-list
view). For a collection of the database the connection is bound to the tree offers
*Empty collection* (`db.coll.deleteMany({})`), *Rename collection*
(`db.coll.renameCollection("new")`) and *Delete* (`db.coll.drop()`), each confirmed with
the exact statement shown. The statements can only name the connected database, so for
another database of the same server nothing destructive is offered. The index manager
lists `db.coll.getIndexes()` (name, key, unique) and creates (`createIndex` on
ascending keys, with a name and the unique flag) and drops (`dropIndex("name")`) indexes
without a transaction; unique indexes feed the duplicate-value warning when adding
rows. There are no constraints (validation is the collection's `$jsonSchema`).

## Cancelling a query (`DBC_FEAT_CANCEL`)

`op.cancel` works through `killOp`. A `mongoc_client_t` cannot be touched from a second
thread while an operation runs on it, so `cancel` (`cancel.c`) reads only state that is
immutable after connect: the DSN, and a per-connection tag (`quaero-cancel-<ObjectId>`,
`utils/cancel_tag.c`) that every `find`/`aggregate` carries as its `comment`. It opens a
short-lived side client from the DSN, lists the operations whose `command.comment` (or
`originatingCommand.comment`, for a `getMore`) is the tag with `$currentOp` and kills
each with `killOp`. The interrupted query fails with *"operation was interrupted"*. It
retries for about 0.75 s when the server has not registered the operation yet. A user
with only the `read` role can cancel their own queries; with no operation killed (finished
already, or no permission to list/kill) the core reports `canceled: false`. Limits:
writes and the utility commands carry no tag and run to completion, and the side client
needs the server to be reachable with the same credentials.

Arrays in result cells are rendered as JSON arrays (`[ 1, 2 ]`), so a JSON cell
edited in the grid round-trips.

## Introspection

- **Collections are tables.** `list_tables` returns the collection names of a
  database; `list_databases` returns the databases. MongoDB has no schema layer
  between database and collection, so `list_schemas` is not implemented and
  `DBC_FEAT_SCHEMAS` is not advertised.
- **Fields are inferred, not declared.** `describe_table` samples documents from
  the collection and reports the observed top-level fields and their neutral
  types (using the same accumulator + type mapping as query flattening). This is
  a sample-based best effort, honest about MongoDB's schemaless nature — it does
  not claim a fixed schema the engine does not enforce.

## Core / vtable / IPC adjustments

**None.** The tabular result model already carries everything MongoDB needs:

- `DBC_TYPE_JSON` already exists and travels end to end (core neutral type →
  IPC wire type name `"json"` → frontend `format.ts`), so nested values need no
  new type.
- Columns are already per-result (each `dbcore_result` names its own columns),
  so a column set that varies by query/page is already expressible.
- SQL NULL is already distinct from empty text, which is exactly how a missing
  field is represented.

The driver does the document→row flattening entirely behind the existing vtable
(`col_count`/`col_name`/`col_type`/`next_row`/`cell_text`). The abstraction is
sufficient; the ABI and IPC protocol are unchanged.

## Pure, testable seams (issue #71)

- `drivers/mongodb/src/utils/bson_types.{c,h}` — `mongo_bson_type_to_neutral`,
  BSON element type → neutral `dbc_type`. Mirrors the BSON spec type bytes with
  no libbson dependency, so it is unit-tested without a MongoDB client.
- `drivers/mongodb/src/utils/columns.{c,h}` — the flatten column-set
  accumulator: union of top-level field names, `_id` hoisted first, first-seen
  order, duplicates ignored. Engine-agnostic and unit-tested.

The driver itself (connect / query via the mongosh-style parser / introspection
over the mongo-c-driver) is issue #47:
`connection.c` (JSON DSN or a full `uri` → a validated mongoc client, pinged at
connect), `query.c` (parse → find/aggregate), `docs.c` (the BSON ↔ result
plumbing and the two-phase flatten, shared with `command.c` and `ddl.c`),
`metadata.c` (list databases/collections, sample-based `describe_table`); later
`command.c` (writes and utility commands), `edit.c`, `ddl.c`, `txn.c`,
`admin.c` (explain, current operations, profiler) and `cancel.c` joined them
(#719). Plus the pure
`utils/json_relax.c` and `utils/value_fmt.c` (BSON datetime → ISO 8601) and the
`utils/result.c` materialized result the readers walk.
