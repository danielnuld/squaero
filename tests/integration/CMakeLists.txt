# Cross-component integration tests: the core driving a real driver. These live
# at the top level (not under core/ or drivers/) so both the dbcore library and
# the driver plugin targets already exist when this is configured.

# Loads the built SQLite plugin at runtime, so it needs the path and a build
# dependency on the plugin (it dlopens it; it does not link it).
add_executable(sqlite_integration_test sqlite_integration_test.c)
target_link_libraries(sqlite_integration_test PRIVATE dbcore cjson)
target_compile_definitions(sqlite_integration_test PRIVATE
  SQLITE_PLUGIN_PATH="$<TARGET_FILE:sqlite_driver>")
add_dependencies(sqlite_integration_test sqlite_driver)
quaero_set_warnings(sqlite_integration_test)
add_test(NAME sqlite_integration_test COMMAND sqlite_integration_test
         WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
