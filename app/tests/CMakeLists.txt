# App-side tests. Verifies the asset-embedding pipeline (.rules/testing.md).
add_executable(embed_test embed_test.c)
target_link_libraries(embed_test PRIVATE frontend_assets)
quaero_set_warnings(embed_test)
add_test(NAME embed_test COMMAND embed_test)

# The remembered window geometry line (issue #685).
add_executable(window_state_test window_state_test.c ../src/window_state.c)
target_include_directories(window_state_test PRIVATE ../include)
quaero_set_warnings(window_state_test)
add_test(NAME window_state_test COMMAND window_state_test)

# The native menu bar's model the UI sends (issue #686).
add_executable(menu_model_test menu_model_test.c ../src/menu_model.c)
target_include_directories(menu_model_test PRIVATE ../include)
target_link_libraries(menu_model_test PRIVATE cjson)
quaero_set_warnings(menu_model_test)
add_test(NAME menu_model_test COMMAND menu_model_test)
