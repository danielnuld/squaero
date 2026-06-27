# quaero — the native application shell.
#
# For M0 this is a placeholder executable that links the core. The real shell
# (webview host: WebView2 / WebKitGTK / WKWebView) is wired up in issue #3, and
# the embedded frontend bundle in issue #5.
add_executable(quaero src/main.c)
target_link_libraries(quaero PRIVATE dbcore)
quaero_set_warnings(quaero)
