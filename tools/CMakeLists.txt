# Developer tools. quaero-rpc pipes stdin JSON-RPC into the core dispatcher and
# prints responses — the smoke suite (scripts/smoke/) drives the real core +
# drivers through it against a live database, no webview.
add_executable(quaero-rpc quaero-rpc.c)
target_link_libraries(quaero-rpc PRIVATE dbcore cjson)
quaero_set_warnings(quaero-rpc)
