# Informix driver.
#
# The driver plugin will link the IBM Informix Client SDK (CSDK), which is
# 32-bit on the target machine — see cmake/toolchain-i686-mingw.cmake. The CSDK
# is proprietary and not redistributable, so the plugin is built as a separate
# module loaded at runtime, only when the SDK is found. That plugin (connect /
# query / result + introspection) lands in issue #48.
#
# The pure helpers — starting with the type mapping (issue #70) — never depend
# on the SDK and are always built and unit-tested, so a checkout without the
# CSDK still configures and builds green.

# --- pure unit tests (always) ---------------------------------------------
if(BUILD_TESTING)
  add_executable(informix_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(informix_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_types_test)
  add_test(NAME informix_types_test COMMAND informix_types_test)
endif()

# --- driver plugin (only when the CSDK is present) ------------------------
# Added in issue #48: detect the CSDK (incl/esql, lib) and build the MODULE
# linking it (or ODBC via the Windows Driver Manager). Deliberately absent for
# now so #70 stays a self-contained, SDK-independent change.
