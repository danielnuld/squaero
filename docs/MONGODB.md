# MongoDB document result model

MongoDB is a document store: a collection holds heterogeneous BSON documents
with no fixed schema. Quaero's result model (`docs/DRIVER_API.md`,
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
simpler alternative. Flattening was chosen because Quaero's UI is a tabular
grid: users expect `name`, `age`, `city` as sortable columns, and the object
tree / `describe_table` view can present a collection's inferred fields as
"columns". Nested structure that has no scalar shape still degrades gracefully
to a JSON cell, so ragged documents are handled without exploding the grid.

## Query language

Quaero's query channel hands a driver one command string. For MongoDB the user
writes a **mongosh-style** expression:

```
db.<collection>.find(<filter?>, <projection?>)[.sort(<doc>)][.skip(<n>)][.limit(<n>)]
db.<collection>.aggregate(<pipeline-array>)
```

- `find` runs `mongoc_collection_find_with_opts`; the optional second argument is
  a projection, and `.sort()`/`.skip()`/`.limit()` chain onto it.
- `aggregate` runs `mongoc_collection_aggregate` over the pipeline array.
- An unbounded `find` (no `.limit()`) is capped at a safety bound
  (`MONGO_SCAN_CAP`, 10000) so it cannot exhaust memory; the core's own row cap
  and truncation flag apply on top.

The argument documents accept the **relaxed** JavaScript-object form the mongo
shell uses — bare (unquoted) keys and single-quoted strings, e.g.
`db.users.find({ age: { $gt: 25 } })`. A pure normalizer
(`utils/json_relax.c`) rewrites them to strict JSON before handing them to
libbson; already-valid JSON passes through unchanged. The command *shape* is
parsed by a pure module (`utils/query_parse.c`); neither depends on libbson, so
both are unit-tested without a MongoDB client. Unsupported operations (insert,
update, remove, …) are rejected with an explicit error rather than faked.

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
connect), `query.c` (parse → find/aggregate → two-phase flatten), `metadata.c`
(list databases/collections, sample-based `describe_table`), plus the pure
`utils/json_relax.c` and `utils/value_fmt.c` (BSON datetime → ISO 8601) and the
`utils/result.c` materialized result the readers walk.
