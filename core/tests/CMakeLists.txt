# Core unit tests, run via CTest. Tests mirror the source layout (.rules/testing.md).
add_executable(version_test version_test.c)
target_link_libraries(version_test PRIVATE dbcore)
quaero_set_warnings(version_test)
add_test(NAME version_test COMMAND version_test)

# IPC dispatcher tests. Links cJSON to inspect response payloads.
add_executable(ipc_test ipc/dispatch_test.c)
target_link_libraries(ipc_test PRIVATE dbcore cjson)
quaero_set_warnings(ipc_test)
add_test(NAME ipc_test COMMAND ipc_test)
