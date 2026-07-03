# MongoDB driver.
#
# MongoDB is a document store, not a tabular engine. The driver flattens each
# document's top-level fields into the neutral tabular result model: a field
# becomes a column (the union across the returned page), nested documents/arrays
# are exchanged as JSON cells, and a missing field is NULL. See docs/MONGODB.md
# for the full result-model decision (#71) — the tabular abstraction suffices,
# so no core/IPC change is needed.
#
# The pure helpers here (BSON type mapping, the flatten column accumulator)
# never depend on libbson/mongoc, so they are always built and unit-tested; a
# checkout without the mongo-c-driver still configures and builds green. The
# driver plugin itself (connect/query/introspection over libmongoc) lands with
# issue #47.

# --- pure unit tests (always) ---------------------------------------------
if(BUILD_TESTING)
  add_executable(mongodb_bson_types_test
    tests/bson_types_test.c
    src/utils/bson_types.c)
  target_include_directories(mongodb_bson_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(mongodb_bson_types_test)
  add_test(NAME mongodb_bson_types_test COMMAND mongodb_bson_types_test)

  add_executable(mongodb_columns_test
    tests/columns_test.c
    src/utils/columns.c)
  target_include_directories(mongodb_columns_test PRIVATE src/utils)
  quaero_set_warnings(mongodb_columns_test)
  add_test(NAME mongodb_columns_test COMMAND mongodb_columns_test)
endif()
