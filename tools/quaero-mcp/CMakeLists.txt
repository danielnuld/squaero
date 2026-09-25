# quaero-mcp — Model Context Protocol server over the Squaero core (issue #184).
# Exposes saved databases to MCP clients (Claude Code) as read-only-by-default
# tools. The connections/policy parser is a small static lib so it can be
# unit-tested without a driver; the statement classifier lives in the core
# (dbcore/stmt_class.h), shared with the iPhone's agent (#580).

add_library(quaero_mcp_pure STATIC mcp_conns.c)
target_include_directories(quaero_mcp_pure PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(quaero_mcp_pure PUBLIC cjson)
quaero_set_warnings(quaero_mcp_pure)

add_executable(quaero-mcp main.c mcp_server.c)
target_link_libraries(quaero-mcp PRIVATE quaero_mcp_pure dbcore cjson)
target_compile_definitions(quaero-mcp
  PRIVATE QUAERO_MCP_VERSION="${PROJECT_VERSION}")
quaero_set_warnings(quaero-mcp)

if(BUILD_TESTING)
  add_executable(mcp_conns_test tests/mcp_conns_test.c)
  target_link_libraries(mcp_conns_test PRIVATE quaero_mcp_pure)
  quaero_set_warnings(mcp_conns_test)
  add_test(NAME mcp_conns_test COMMAND mcp_conns_test)
endif()
