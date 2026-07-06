# quaero — the native application shell (webview host).
#
# Creates the OS window, loads the embedded frontend bundle, and bridges the
# JS <-> C core JSON-RPC channel. Backed by webview (WebView2 / WebKitGTK /
# WKWebView). The shell is C++ (where webview lives); the core stays pure C.
include(EmbedAssets)
include(FetchContent)

# --- Embed the frontend bundle (real dist/ if built, else placeholder) ----
set(QUAERO_ASSETS_C "${CMAKE_CURRENT_BINARY_DIR}/frontend_assets.c")
quaero_generate_embedded_html("${QUAERO_ASSETS_C}" quaero_frontend_html)

# Generated code: deliberately not subject to the strict warning policy.
add_library(frontend_assets STATIC "${QUAERO_ASSETS_C}")
target_include_directories(frontend_assets PUBLIC include)

# --- webview ---------------------------------------------------------------
FetchContent_Declare(
  webview
  GIT_REPOSITORY https://github.com/webview/webview
  GIT_TAG 0.12.0)
FetchContent_MakeAvailable(webview)

# --- App executable --------------------------------------------------------
add_executable(quaero src/main.cc)
target_link_libraries(quaero PRIVATE dbcore frontend_assets cjson webview::core)

# Windows: embed a VERSIONINFO resource so Explorer/taskbar show the product
# name, version and author (issue #192). The version is configured from the
# single-source project() version (→ top-level VERSION file); no version is
# hardcoded in the .rc. #190 will add the application icon to the same resource.
if(WIN32)
  enable_language(RC)
  # Absolute path with forward slashes for the ICON directive (accepted by both
  # the MSVC rc compiler and MinGW windres).
  set(QUAERO_ICON_PATH "${CMAKE_SOURCE_DIR}/assets/icons/quaero.ico")
  set(QUAERO_RC "${CMAKE_CURRENT_BINARY_DIR}/quaero.rc")
  configure_file("${CMAKE_CURRENT_SOURCE_DIR}/quaero.rc.in" "${QUAERO_RC}" @ONLY)
  target_sources(quaero PRIVATE "${QUAERO_RC}")

  # Build as a GUI-subsystem app so double-clicking (or launching) does NOT pop a
  # console window (issue: hide the cmd window). MinGW's -mwindows keeps int
  # main() via its WinMain shim; MSVC needs the entry point pointed back at
  # mainCRTStartup since /SUBSYSTEM:WINDOWS otherwise expects WinMain. The
  # printf startup diagnostics simply have no console to write to — acceptable.
  set_target_properties(quaero PROPERTIES WIN32_EXECUTABLE TRUE)
  if(MSVC)
    target_link_options(quaero PRIVATE /ENTRY:mainCRTStartup)
  endif()
endif()

# Windows: main.cc uses the WebView2 SDK header (ICoreWebView2_3) to serve the UI
# from a stable virtual-host origin so localStorage persists. The header ships
# with the WebView2 package fetched by webview; add its include dir.
if(WIN32)
  target_include_directories(quaero PRIVATE
    "${CMAKE_BINARY_DIR}/_deps/microsoft_web_webview2-src/build/native/include")
  target_link_libraries(quaero PRIVATE shell32 ole32)
endif()
# Note: strict warnings are intentionally not applied here — this target
# includes the third-party C++ webview header.

# Stage driver plugins next to the executable so the shell discovers them at
# startup (it scans <exe_dir>/drivers). The plugin is loaded at runtime, not
# linked, so this is a build dependency plus a copy.
add_dependencies(quaero sqlite_driver)
add_custom_command(TARGET quaero POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:quaero>/drivers"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "$<TARGET_FILE:sqlite_driver>" "$<TARGET_FILE_DIR:quaero>/drivers/"
  VERBATIM)

# The Informix driver is built only when ODBC is present (it links the system
# ODBC Driver Manager); stage it alongside the executable when it exists. On the
# target machine this is the 32-bit x86 build, since the Informix CSDK is 32-bit.
if(TARGET informix_driver)
  add_dependencies(quaero informix_driver)
  add_custom_command(TARGET quaero POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:informix_driver>" "$<TARGET_FILE_DIR:quaero>/drivers/"
    VERBATIM)
endif()

# The MongoDB driver is built only when the mongo-c-driver is present; stage it
# alongside the executable when it exists.
if(TARGET mongodb_driver)
  add_dependencies(quaero mongodb_driver)
  add_custom_command(TARGET quaero POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:mongodb_driver>" "$<TARGET_FILE_DIR:quaero>/drivers/"
    VERBATIM)
endif()

if(BUILD_TESTING)
  add_subdirectory(tests)
endif()
