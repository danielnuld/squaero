# SQL Server driver (issue #49).
#
# The plugin links FreeTDS's db-lib. It is built only when FreeTDS is available,
# so a checkout without it still configures and builds green — the plugin is
# simply absent there. The pure helpers (quoting, type mapping, options) never
# depend on FreeTDS and are always built and unit-tested.

# --- pure unit tests (always) ---------------------------------------------
if(BUILD_TESTING)
  add_executable(mssql_identifier_test
    tests/identifier_test.c
    src/utils/identifier.c)
  target_include_directories(mssql_identifier_test PRIVATE src/utils)
  quaero_set_warnings(mssql_identifier_test)
  add_test(NAME mssql_identifier_test COMMAND mssql_identifier_test)

  add_executable(mssql_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(mssql_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(mssql_types_test)
  add_test(NAME mssql_types_test COMMAND mssql_types_test)

  add_executable(mssql_options_test
    tests/options_test.c
    src/utils/options.c)
  target_include_directories(mssql_options_test PRIVATE src/utils)
  quaero_set_warnings(mssql_options_test)
  add_test(NAME mssql_options_test COMMAND mssql_options_test)
endif()

# --- driver plugin --------------------------------------------------------
set(MSSQL_DRIVER_SRC
  src/entry.c
  src/connection.c
  src/query.c
  src/metadata.c
  src/utils/identifier.c
  src/utils/types.c
  src/utils/options.c)

macro(_quaero_mssql_common)
  target_include_directories(mssql_driver PRIVATE
    src ${CMAKE_SOURCE_DIR}/core/include)
  target_link_libraries(mssql_driver PRIVATE cjson)
  set_target_properties(mssql_driver PROPERTIES PREFIX "" OUTPUT_NAME "mssql")
  quaero_set_warnings(mssql_driver)
endmacro()

# Build FreeTDS from source when asked (the x86 Windows release, where no 32-bit
# FreeTDS ships; see cmake/QuaeroFreeTDS.cmake). Otherwise use a system FreeTDS
# (e.g. Debian/Ubuntu's freetds-dev) when it links for this target.
option(QUAERO_FREETDS "Fetch + build FreeTDS (static db-lib) for the SQL Server plugin" OFF)

if(QUAERO_FREETDS)
  add_library(mssql_driver ${QUAERO_DRIVER_LIB_TYPE} ${MSSQL_DRIVER_SRC})
  _quaero_mssql_common()
  include(QuaeroFreeTDS)
  quaero_enable_freetds(mssql_driver)
  message(STATUS "SQL Server driver: building FreeTDS db-lib from source (QUAERO_FREETDS=ON)")
  return()
endif()

find_path(FREETDS_INCLUDE_DIR NAMES sybdb.h PATH_SUFFIXES freetds)
find_library(FREETDS_SYBDB_LIBRARY NAMES sybdb)

if(FREETDS_INCLUDE_DIR AND FREETDS_SYBDB_LIBRARY)
  include(CheckCSourceCompiles)
  set(CMAKE_REQUIRED_INCLUDES ${FREETDS_INCLUDE_DIR})
  set(CMAKE_REQUIRED_LIBRARIES ${FREETDS_SYBDB_LIBRARY})
  # Not only "does it link": the driver needs the login-record setters for the
  # encryption level and the port, which FreeTDS added in 1.4. Ubuntu 24.04 ships
  # 1.3, where the DSN's `encryption` could only be ignored — and a connection
  # that asked for encryption must never be opened without it. So an older
  # FreeTDS means no plugin, said out loud, rather than a quietly weaker one.
  check_c_source_compiles(
    "#include <sybfront.h>\n#include <sybdb.h>\nint main(void){ LOGINREC *l = dblogin(); DBSETLENCRYPTION(l, \"require\"); DBSETLPORT(l, 1433); return dbinit() == FAIL; }"
    FREETDS_SYBDB_USABLE)
  unset(CMAKE_REQUIRED_INCLUDES)
  unset(CMAKE_REQUIRED_LIBRARIES)
endif()

if(FREETDS_INCLUDE_DIR AND FREETDS_SYBDB_LIBRARY AND FREETDS_SYBDB_USABLE)
  add_library(mssql_driver ${QUAERO_DRIVER_LIB_TYPE} ${MSSQL_DRIVER_SRC})
  _quaero_mssql_common()
  target_include_directories(mssql_driver SYSTEM PRIVATE ${FREETDS_INCLUDE_DIR})
  target_link_libraries(mssql_driver PRIVATE ${FREETDS_SYBDB_LIBRARY})
  message(STATUS "SQL Server driver: using ${FREETDS_SYBDB_LIBRARY}")
elseif(FREETDS_INCLUDE_DIR AND FREETDS_SYBDB_LIBRARY)
  message(STATUS "SQL Server driver: the system FreeTDS lacks DBSETLENCRYPTION/DBSETLPORT "
    "(needs 1.4+) or does not link for this target; plugin not built")
else()
  message(STATUS "SQL Server driver: FreeTDS db-lib not found; plugin not built")
endif()
