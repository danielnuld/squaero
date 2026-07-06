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

  add_executable(mongodb_query_parse_test
    tests/query_parse_test.c
    src/utils/query_parse.c)
  target_include_directories(mongodb_query_parse_test PRIVATE src/utils)
  quaero_set_warnings(mongodb_query_parse_test)
  add_test(NAME mongodb_query_parse_test COMMAND mongodb_query_parse_test)

  add_executable(mongodb_result_test
    tests/result_test.c
    src/utils/result.c)
  target_include_directories(mongodb_result_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(mongodb_result_test)
  add_test(NAME mongodb_result_test COMMAND mongodb_result_test)

  add_executable(mongodb_value_fmt_test
    tests/value_fmt_test.c
    src/utils/value_fmt.c)
  target_include_directories(mongodb_value_fmt_test PRIVATE src/utils)
  quaero_set_warnings(mongodb_value_fmt_test)
  add_test(NAME mongodb_value_fmt_test COMMAND mongodb_value_fmt_test)

  add_executable(mongodb_json_relax_test
    tests/json_relax_test.c
    src/utils/json_relax.c)
  target_include_directories(mongodb_json_relax_test PRIVATE src/utils)
  quaero_set_warnings(mongodb_json_relax_test)
  add_test(NAME mongodb_json_relax_test COMMAND mongodb_json_relax_test)
endif()

# --- driver plugin (when the mongo-c-driver is available) ------------------
# libmongoc/libbson are discovered via pkg-config (libmongoc-1.0). Where that
# fails (e.g. Windows without a system install), -DQUAERO_MONGOC=ON fetches and
# statically links mongo-c-driver instead (cmake/QuaeroMongoc.cmake). If neither
# is available the plugin is skipped (green), like the MySQL/Informix drivers.
option(QUAERO_MONGOC "Fetch + build mongo-c-driver for the MongoDB plugin" OFF)

find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
  pkg_check_modules(MONGOC libmongoc-1.0)
endif()

if(MONGOC_FOUND OR QUAERO_MONGOC)
  add_library(mongodb_driver MODULE
    src/entry.c
    src/connection.c
    src/query.c
    src/metadata.c
    src/utils/bson_types.c
    src/utils/columns.c
    src/utils/json_relax.c
    src/utils/query_parse.c
    src/utils/result.c
    src/utils/value_fmt.c)
  target_include_directories(mongodb_driver PRIVATE
    src ${CMAKE_SOURCE_DIR}/core/include)
  # cjson supplies cJSON.h (DSN parsing), exactly as the other drivers do.
  target_link_libraries(mongodb_driver PRIVATE cjson)

  if(MONGOC_FOUND)
    message(STATUS "MongoDB driver: using system libmongoc (${MONGOC_VERSION})")
    # mongoc headers are included as SYSTEM so their own code does not trip -Werror.
    target_include_directories(mongodb_driver SYSTEM PRIVATE ${MONGOC_INCLUDE_DIRS})
    target_link_directories(mongodb_driver PRIVATE ${MONGOC_LIBRARY_DIRS})
    target_link_libraries(mongodb_driver PRIVATE ${MONGOC_LIBRARIES})
  else()
    message(STATUS "MongoDB driver: fetching mongo-c-driver (QUAERO_MONGOC=ON)")
    include(QuaeroMongoc)
    quaero_enable_mongoc(mongodb_driver)
  endif()

  set_target_properties(mongodb_driver PROPERTIES PREFIX "" OUTPUT_NAME "mongodb")
  quaero_set_warnings(mongodb_driver)
else()
  message(STATUS "MongoDB driver: libmongoc not found; plugin not built (set -DQUAERO_MONGOC=ON to fetch it)")
endif()
