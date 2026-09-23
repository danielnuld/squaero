# Database driver plugins are registered here as they are implemented.
#
# Each driver is a shared library implementing the vtable in
# docs/DRIVER_API.md and is loaded at runtime by libdbcore.
add_subdirectory(sqlite)
add_subdirectory(postgres)
add_subdirectory(mysql)
add_subdirectory(informix)
add_subdirectory(mongodb)
add_subdirectory(mssql)

# --- Static registry (QUAERO_STATIC_DRIVERS, issue #573) ------------------
# Every driver exports the same dbc_driver_entry, which would collide once the
# six are linked into one binary. Renaming it with a define gives each a unique
# symbol (dbc_driver_entry_sqlite, ...) without touching the sources, and the
# generated table lists whichever drivers this configuration actually built.
if(QUAERO_STATIC_DRIVERS)
  set(QUAERO_STATIC_DECLS "")
  set(QUAERO_STATIC_ENTRIES "")
  set(_static_drivers "")
  foreach(_d sqlite postgres mysql informix mongodb mssql)
    if(TARGET ${_d}_driver)
      target_compile_definitions(${_d}_driver PRIVATE
        dbc_driver_entry=dbc_driver_entry_${_d})
      string(APPEND QUAERO_STATIC_DECLS
        "const dbc_driver_t *dbc_driver_entry_${_d}(void);\n")
      string(APPEND QUAERO_STATIC_ENTRIES "    dbc_driver_entry_${_d},\n")
      list(APPEND _static_drivers ${_d}_driver)
    endif()
  endforeach()
  configure_file(static/static_registry.c.in
    ${CMAKE_CURRENT_BINARY_DIR}/static_registry.c @ONLY)

  add_library(quaero_static_drivers STATIC
    ${CMAKE_CURRENT_BINARY_DIR}/static_registry.c)
  target_include_directories(quaero_static_drivers PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/static)
  target_link_libraries(quaero_static_drivers PUBLIC dbcore ${_static_drivers})
  quaero_set_warnings(quaero_static_drivers)
  message(STATUS "Squaero: static drivers: ${_static_drivers}")

  if(BUILD_TESTING)
    add_executable(static_registry_test static/static_registry_test.c)
    target_link_libraries(static_registry_test PRIVATE quaero_static_drivers cjson)
    string(REPLACE "_driver" "" _names "${_static_drivers}")
    string(REPLACE ";" "," _names "${_names}")
    target_compile_definitions(static_registry_test PRIVATE
      QUAERO_STATIC_DRIVER_NAMES="${_names}")
    quaero_set_warnings(static_registry_test)
    add_test(NAME static_registry_test COMMAND static_registry_test)
  endif()
endif()
