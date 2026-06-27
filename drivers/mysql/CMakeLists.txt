# MySQL / MariaDB driver.
#
# The driver plugin links the MySQL client library (MariaDB Connector/C) and
# needs a running server for its integration tests — both a CI infrastructure
# decision — so the plugin target lands later behind a QUAERO_BUILD_MYSQL option.
# The pure type mapping has no client dependency, so it is always built and
# unit-tested here, keeping M4 progress green on every platform.

if(BUILD_TESTING)
  add_executable(mysql_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(mysql_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(mysql_types_test)
  add_test(NAME mysql_types_test COMMAND mysql_types_test)
endif()
