# Core unit tests, run via CTest. Tests mirror the source layout (.rules/testing.md).
add_executable(version_test version_test.c)
target_link_libraries(version_test PRIVATE dbcore)
quaero_set_warnings(version_test)
add_test(NAME version_test COMMAND version_test)

# dbc_status self-containment: compiles against dbcore/status.h alone (issue #77)
# and locks the ABI-visible code values.
add_executable(status_test driver/status_test.c)
target_link_libraries(status_test PRIVATE dbcore)
quaero_set_warnings(status_test)
add_test(NAME status_test COMMAND status_test)

# Driver vtable validation tests (load-time ABI/required-member gate).
add_executable(driver_validate_test driver/validate_test.c)
target_link_libraries(driver_validate_test PRIVATE dbcore)
quaero_set_warnings(driver_validate_test)
add_test(NAME driver_validate_test COMMAND driver_validate_test)

# Pure filename-classification helper for the loader.
add_executable(plugin_name_test driver/plugin_name_test.c)
target_link_libraries(plugin_name_test PRIVATE dbcore)
quaero_set_warnings(plugin_name_test)
add_test(NAME plugin_name_test COMMAND plugin_name_test)

# Loader smoke test: build real fixture plugins and load them at runtime.
# All fixtures land in one directory so the scan test can enumerate them.
set(fixtures_dir "${CMAKE_CURRENT_BINARY_DIR}/fixtures")
foreach(fx good_driver bad_abi_driver no_entry)
  add_library(${fx} MODULE driver/fixtures/${fx}.c)
  # Header-only dependency on the driver contract; no link to the core.
  target_include_directories(${fx} PRIVATE ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(${fx})  # the driver side of the ABI must also be clean
  set_target_properties(${fx} PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${fixtures_dir}"
    RUNTIME_OUTPUT_DIRECTORY "${fixtures_dir}"
    PREFIX "")  # stable, predictable file names across platforms
endforeach()

add_executable(loader_test driver/loader_test.c)
target_link_libraries(loader_test PRIVATE dbcore)
quaero_set_warnings(loader_test)
add_dependencies(loader_test good_driver bad_abi_driver no_entry)
target_compile_definitions(loader_test PRIVATE
  GOOD_DRIVER_PATH="$<TARGET_FILE:good_driver>"
  BAD_ABI_DRIVER_PATH="$<TARGET_FILE:bad_abi_driver>"
  NO_ENTRY_PATH="$<TARGET_FILE:no_entry>"
  FIXTURES_DIR="$<TARGET_FILE_DIR:good_driver>")
add_test(NAME loader_test COMMAND loader_test)

# IPC dispatcher tests. Links cJSON to inspect response payloads.
add_executable(ipc_test ipc/dispatch_test.c)
target_link_libraries(ipc_test PRIVATE dbcore cjson)
quaero_set_warnings(ipc_test)
add_test(NAME ipc_test COMMAND ipc_test)

# Connection manager (lifecycle through the vtable, incl. SSH-tunnel gating).
add_executable(conn_manager_test conn/manager_test.c)
target_link_libraries(conn_manager_test PRIVATE dbcore)
target_include_directories(conn_manager_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/conn)
quaero_set_warnings(conn_manager_test)
add_test(NAME conn_manager_test COMMAND conn_manager_test)

# SSH-tunnel DSN field parser (pure). Needs cJSON-free internal header only.
add_executable(ssh_config_test conn/ssh_config_test.c)
target_link_libraries(ssh_config_test PRIVATE dbcore)
target_include_directories(ssh_config_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/conn)
quaero_set_warnings(ssh_config_test)
add_test(NAME ssh_config_test COMMAND ssh_config_test)

# Loopback DSN rewrite for tunnelled connections. Inspects JSON via cJSON.
add_executable(dsn_rewrite_test conn/dsn_rewrite_test.c)
target_link_libraries(dsn_rewrite_test PRIVATE dbcore cjson)
target_include_directories(dsn_rewrite_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/conn)
quaero_set_warnings(dsn_rewrite_test)
add_test(NAME dsn_rewrite_test COMMAND dsn_rewrite_test)

# Process runtime (driver registry + connection manager).
add_executable(runtime_test runtime_test.c)
target_link_libraries(runtime_test PRIVATE dbcore)
quaero_set_warnings(runtime_test)
add_test(NAME runtime_test COMMAND runtime_test)

# Query execution + neutral result-set model.
add_executable(query_test query/query_test.c)
target_link_libraries(query_test PRIVATE dbcore)
quaero_set_warnings(query_test)
add_test(NAME query_test COMMAND query_test)

# conn.open / conn.close IPC methods + id helpers. Needs the internal ipc
# header for the id helpers, and cJSON to inspect responses.
add_executable(conn_methods_test ipc/conn_methods_test.c)
target_link_libraries(conn_methods_test PRIVATE dbcore cjson)
target_include_directories(conn_methods_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/ipc)
quaero_set_warnings(conn_methods_test)
add_test(NAME conn_methods_test COMMAND conn_methods_test)

# Result-set JSON serialization. Uses the internal result builder + serializer.
add_executable(result_json_test ipc/result_json_test.c)
target_link_libraries(result_json_test PRIVATE dbcore cjson)
target_include_directories(result_json_test PRIVATE
  ${CMAKE_SOURCE_DIR}/core/src/ipc ${CMAKE_SOURCE_DIR}/core/src/query)
quaero_set_warnings(result_json_test)
add_test(NAME result_json_test COMMAND result_json_test)

# query.run IPC method, end-to-end through the public dispatcher.
add_executable(query_run_test ipc/query_run_test.c)
target_link_libraries(query_run_test PRIVATE dbcore cjson)
quaero_set_warnings(query_run_test)
add_test(NAME query_run_test COMMAND query_run_test)

# In-flight op registry: cancel routing, feature gating, idle/no-op cases.
add_executable(op_registry_test query/op_registry_test.c)
target_link_libraries(op_registry_test PRIVATE dbcore)
quaero_set_warnings(op_registry_test)
add_test(NAME op_registry_test COMMAND op_registry_test)

# op.cancel IPC method, end-to-end through the public dispatcher.
add_executable(op_cancel_test ipc/op_cancel_test.c)
target_link_libraries(op_cancel_test PRIVATE dbcore cjson)
quaero_set_warnings(op_cancel_test)
add_test(NAME op_cancel_test COMMAND op_cancel_test)

# Schema introspection layer (routing + unsupported + param validation).
add_executable(schema_test query/schema_test.c)
target_link_libraries(schema_test PRIVATE dbcore)
quaero_set_warnings(schema_test)
add_test(NAME schema_test COMMAND schema_test)

# Transaction-control wrappers (feature gating + error propagation).
add_executable(tx_test query/tx_test.c)
target_link_libraries(tx_test PRIVATE dbcore)
quaero_set_warnings(tx_test)
add_test(NAME tx_test COMMAND tx_test)
