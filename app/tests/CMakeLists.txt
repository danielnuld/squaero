# App-side tests. Verifies the asset-embedding pipeline (.rules/testing.md).
add_executable(embed_test embed_test.c)
target_link_libraries(embed_test PRIVATE frontend_assets)
quaero_set_warnings(embed_test)
add_test(NAME embed_test COMMAND embed_test)
