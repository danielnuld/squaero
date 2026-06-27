# SQLite reference driver — a runtime-loaded plugin implementing the vtable.
# It links the vendored SQLite + cJSON (for DSN parsing) but NOT libdbcore: a
# driver depends only on the driver.h contract, never on the core.
set(SQLITE_DRIVER_SRC
  src/entry.c
  src/connection.c
  src/query.c
  src/metadata.c
  src/ddl.c
  src/utils/types.c
  src/utils/identifier.c
)

add_library(sqlite_driver MODULE ${SQLITE_DRIVER_SRC})
target_include_directories(sqlite_driver PRIVATE
  src ${CMAKE_SOURCE_DIR}/core/include)
target_link_libraries(sqlite_driver PRIVATE sqlite3 cjson)
# Plugin file name is "sqlite.<ext>" (no lib prefix) so the loader's candidate
# rule and a clean engine name both hold.
set_target_properties(sqlite_driver PROPERTIES PREFIX "" OUTPUT_NAME "sqlite")
quaero_set_warnings(sqlite_driver)

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
