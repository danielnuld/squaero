# quaero — the native application shell.
#
# For M0 this is a placeholder executable that links the core and the embedded
# frontend bundle. The real shell (webview host: WebView2 / WebKitGTK /
# WKWebView) is wired up in issue #3.
include(EmbedAssets)

# Embed the frontend bundle (real dist/ if built, else the placeholder).
set(QUAERO_ASSETS_C "${CMAKE_CURRENT_BINARY_DIR}/frontend_assets.c")
quaero_generate_embedded_html("${QUAERO_ASSETS_C}" quaero_frontend_html)

# Generated code: deliberately not subject to the strict warning policy.
add_library(frontend_assets STATIC "${QUAERO_ASSETS_C}")
target_include_directories(frontend_assets PUBLIC include)

add_executable(quaero src/main.c)
target_link_libraries(quaero PRIVATE dbcore frontend_assets)
quaero_set_warnings(quaero)

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
