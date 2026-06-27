# MySQL / MariaDB driver.
#
# The driver plugin links the MySQL client library (MariaDB Connector/C). It is
# built only when that library is found, so a checkout without the client lib
# (and CI runners where it is not installed) still configures and builds green —
# the plugin is simply absent there. The pure helpers (type mapping, identifier
# quoting) never depend on the client lib and are always built and unit-tested.

# --- pure unit tests (always) ---------------------------------------------
if(BUILD_TESTING)
  add_executable(mysql_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(mysql_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(mysql_types_test)
  add_test(NAME mysql_types_test COMMAND mysql_types_test)

  add_executable(mysql_identifier_test
    tests/identifier_test.c
    src/utils/identifier.c)
  target_include_directories(mysql_identifier_test PRIVATE src/utils)
  quaero_set_warnings(mysql_identifier_test)
  add_test(NAME mysql_identifier_test COMMAND mysql_identifier_test)
endif()

# --- driver plugin (only when the client library is present) --------------
# MariaDB Connector/C ships mysql.h (a compatibility header) and libmariadb.
find_path(MYSQL_INCLUDE_DIR NAMES mysql.h
  PATH_SUFFIXES mariadb mysql)
find_library(MYSQL_CLIENT_LIBRARY NAMES mariadb libmariadb mariadbclient mysqlclient)

if(MYSQL_INCLUDE_DIR AND MYSQL_CLIENT_LIBRARY)
  message(STATUS "MySQL driver: using ${MYSQL_CLIENT_LIBRARY} (headers ${MYSQL_INCLUDE_DIR})")
  add_library(mysql_driver MODULE
    src/entry.c
    src/connection.c
    src/query.c
    src/metadata.c
    src/ddl.c
    src/utils/types.c
    src/utils/identifier.c)
  # The client headers are third-party: include them as SYSTEM so they are not
  # subject to the strict -Werror policy applied to our own code.
  target_include_directories(mysql_driver PRIVATE
    src ${CMAKE_SOURCE_DIR}/core/include)
  target_include_directories(mysql_driver SYSTEM PRIVATE ${MYSQL_INCLUDE_DIR})
  # cjson supplies cJSON.h (used for DSN parsing); linking it propagates its
  # include dir, exactly as the SQLite driver does.
  target_link_libraries(mysql_driver PRIVATE ${MYSQL_CLIENT_LIBRARY} cjson)
  set_target_properties(mysql_driver PROPERTIES PREFIX "" OUTPUT_NAME "mysql")
  quaero_set_warnings(mysql_driver)
else()
  message(STATUS "MySQL driver: MariaDB Connector/C not found; plugin not built")
endif()
