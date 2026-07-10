# SQLite driver tests, run via CTest.

# Pure type-affinity mapping (compiles the helper directly).
add_executable(sqlite_types_test
  types_test.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/types.c)
target_include_directories(sqlite_types_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils ${CMAKE_SOURCE_DIR}/core/include)
quaero_set_warnings(sqlite_types_test)
add_test(NAME sqlite_types_test COMMAND sqlite_types_test)

# Pure identifier quoting (compiles the helper directly).
add_executable(sqlite_identifier_test
  identifier_test.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/identifier.c)
target_include_directories(sqlite_identifier_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils)
quaero_set_warnings(sqlite_identifier_test)
add_test(NAME sqlite_identifier_test COMMAND sqlite_identifier_test)

# Pure single-row DML builder (INSERT/UPDATE/DELETE literal SQL).
add_executable(sqlite_dml_test
  dml_test.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/dml.c)
target_include_directories(sqlite_dml_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils ${CMAKE_SOURCE_DIR}/core/include)
quaero_set_warnings(sqlite_dml_test)
add_test(NAME sqlite_dml_test COMMAND sqlite_dml_test)

# The driver sources, reused by the integration-style tests below. Compiled
# directly into each test (entry.c's exported symbol is then kept).
set(SQLITE_DRIVER_TEST_SRC
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/entry.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/connection.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/query.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/metadata.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ddl.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/edit.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/types.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/identifier.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/utils/dml.c)

# Connection / DSN parsing edge cases through the vtable.
add_executable(sqlite_connection_test connection_test.c ${SQLITE_DRIVER_TEST_SRC})
target_include_directories(sqlite_connection_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src ${CMAKE_SOURCE_DIR}/core/include)
target_link_libraries(sqlite_connection_test PRIVATE sqlite3 cjson)
quaero_set_warnings(sqlite_connection_test)
add_test(NAME sqlite_connection_test COMMAND sqlite_connection_test)

# Smoke test: a real round trip through the driver's own vtable.
add_executable(sqlite_smoke_test smoke_test.c ${SQLITE_DRIVER_TEST_SRC})
target_include_directories(sqlite_smoke_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src ${CMAKE_SOURCE_DIR}/core/include)
target_link_libraries(sqlite_smoke_test PRIVATE sqlite3 cjson)
quaero_set_warnings(sqlite_smoke_test)
add_test(NAME sqlite_smoke_test COMMAND sqlite_smoke_test)

# Query cancellation: contract + a real, thread-free interrupt via a progress hook.
add_executable(sqlite_cancel_test cancel_test.c ${SQLITE_DRIVER_TEST_SRC})
target_include_directories(sqlite_cancel_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src ${CMAKE_SOURCE_DIR}/core/include)
target_link_libraries(sqlite_cancel_test PRIVATE sqlite3 cjson)
quaero_set_warnings(sqlite_cancel_test)
add_test(NAME sqlite_cancel_test COMMAND sqlite_cancel_test)

# Introspection: list_tables / describe_table / get_ddl through the vtable.
add_executable(sqlite_introspect_test introspect_test.c ${SQLITE_DRIVER_TEST_SRC})
target_include_directories(sqlite_introspect_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src ${CMAKE_SOURCE_DIR}/core/include)
target_link_libraries(sqlite_introspect_test PRIVATE sqlite3 cjson)
quaero_set_warnings(sqlite_introspect_test)
add_test(NAME sqlite_introspect_test COMMAND sqlite_introspect_test)
