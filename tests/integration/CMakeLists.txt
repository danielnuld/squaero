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

# MongoDB integration runs only when the driver was built (mongo-c-driver
# present). The test SKIPS at runtime unless QUAERO_MONGODB_DSN points at a
# server pre-seeded with the quaero_it collection (CI seeds it).
if(TARGET mongodb_driver)
  add_executable(mongodb_integration_test mongodb_integration_test.c)
  target_link_libraries(mongodb_integration_test PRIVATE dbcore cjson)
  target_compile_definitions(mongodb_integration_test PRIVATE
    MONGODB_PLUGIN_PATH="$<TARGET_FILE:mongodb_driver>")
  add_dependencies(mongodb_integration_test mongodb_driver)
  quaero_set_warnings(mongodb_integration_test)
  add_test(NAME mongodb_integration_test COMMAND mongodb_integration_test
           WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

  # Cancel contract: asserts the driver honestly does NOT advertise cancellation
  # (mongoc has no thread-safe interrupt). Needs no server — just the plugin.
  add_executable(mongodb_cancel_test mongodb_cancel_test.c)
  target_link_libraries(mongodb_cancel_test PRIVATE dbcore cjson)
  target_compile_definitions(mongodb_cancel_test PRIVATE
    MONGODB_PLUGIN_PATH="$<TARGET_FILE:mongodb_driver>")
  add_dependencies(mongodb_cancel_test mongodb_driver)
  quaero_set_warnings(mongodb_cancel_test)
  add_test(NAME mongodb_cancel_test COMMAND mongodb_cancel_test
           WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
endif()

# MySQL integration runs only when the driver was built (client lib present).
# The test itself SKIPS at runtime unless QUAERO_MYSQL_DSN points at a server,
# so it is harmless on machines/CI jobs without one.
if(TARGET mysql_driver)
  add_executable(mysql_integration_test mysql_integration_test.c)
  target_link_libraries(mysql_integration_test PRIVATE dbcore cjson)
  target_compile_definitions(mysql_integration_test PRIVATE
    MYSQL_PLUGIN_PATH="$<TARGET_FILE:mysql_driver>")
  add_dependencies(mysql_integration_test mysql_driver)
  quaero_set_warnings(mysql_integration_test)
  add_test(NAME mysql_integration_test COMMAND mysql_integration_test
           WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

  # Cancel: a background thread runs a slow query while the main thread issues
  # op.cancel, which reaches the driver's KILL QUERY. Asserts the query returns
  # promptly. SKIPS unless QUAERO_MYSQL_DSN is set; needs a threads library.
  add_executable(mysql_cancel_integration_test mysql_cancel_integration_test.c)
  target_link_libraries(mysql_cancel_integration_test PRIVATE dbcore cjson)
  find_package(Threads REQUIRED)
  target_link_libraries(mysql_cancel_integration_test PRIVATE Threads::Threads)
  target_compile_definitions(mysql_cancel_integration_test PRIVATE
    MYSQL_PLUGIN_PATH="$<TARGET_FILE:mysql_driver>")
  add_dependencies(mysql_cancel_integration_test mysql_driver)
  quaero_set_warnings(mysql_cancel_integration_test)
  add_test(NAME mysql_cancel_integration_test COMMAND mysql_cancel_integration_test
           WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
  # A cancel that silently does nothing would make the slow query run its full
  # sleep; fail fast rather than stall the suite.
  set_tests_properties(mysql_cancel_integration_test PROPERTIES TIMEOUT 60)

  # SSL: opens an encrypted connection (ssl_mode=required) and checks Ssl_cipher.
  # SKIPS unless QUAERO_MYSQL_SSL_DSN points at a TLS-enabled server.
  add_executable(mysql_ssl_integration_test mysql_ssl_integration_test.c)
  target_link_libraries(mysql_ssl_integration_test PRIVATE dbcore cjson)
  target_compile_definitions(mysql_ssl_integration_test PRIVATE
    MYSQL_PLUGIN_PATH="$<TARGET_FILE:mysql_driver>")
  add_dependencies(mysql_ssl_integration_test mysql_driver)
  quaero_set_warnings(mysql_ssl_integration_test)
  add_test(NAME mysql_ssl_integration_test COMMAND mysql_ssl_integration_test
           WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

  # SSH-tunnel integration: opens the MySQL connection through a real SSH
  # port-forward. Needs both the driver and tunnel support compiled in; SKIPS at
  # runtime unless QUAERO_SSH_DSN points at a tunnelled server.
  if(QUAERO_SSH)
    add_executable(ssh_tunnel_integration_test ssh_tunnel_integration_test.c)
    target_link_libraries(ssh_tunnel_integration_test PRIVATE dbcore cjson)
    target_compile_definitions(ssh_tunnel_integration_test PRIVATE
      MYSQL_PLUGIN_PATH="$<TARGET_FILE:mysql_driver>")
    add_dependencies(ssh_tunnel_integration_test mysql_driver)
    quaero_set_warnings(ssh_tunnel_integration_test)
    add_test(NAME ssh_tunnel_integration_test COMMAND ssh_tunnel_integration_test
             WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    # A forwarding bug could hang the handshake; fail fast instead of running
    # until the CI job's global timeout.
    set_tests_properties(ssh_tunnel_integration_test PROPERTIES TIMEOUT 90)
  endif()
endif()
