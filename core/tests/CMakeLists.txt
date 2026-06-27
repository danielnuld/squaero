# Core unit tests, run via CTest. Tests mirror the source layout (.rules/testing.md).
add_executable(version_test version_test.c)
target_link_libraries(version_test PRIVATE dbcore)
quaero_set_warnings(version_test)
add_test(NAME version_test COMMAND version_test)
