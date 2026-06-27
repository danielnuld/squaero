cmake_minimum_required(VERSION 3.20)

project(quaero
  VERSION 0.0.1
  DESCRIPTION "Modern, lightweight, multi-engine database client"
  LANGUAGES C CXX)

# --- Language standard ---------------------------------------------------
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# C++ is used only by the native app shell (the webview host). The core and
# drivers stay pure C.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The webview app needs platform GUI dev packages (GTK4/WebKitGTK on Linux,
# WebView2 on Windows, WebKit on macOS). Turn this off to build only the core
# and its tests on a machine without those.
option(QUAERO_BUILD_APP "Build the native webview application shell" ON)

# --- Default build type (single-config generators) -----------------------
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

# --- Shared CMake helpers ------------------------------------------------
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(QuaeroWarnings)

# Defines BUILD_TESTING (default ON) and calls enable_testing().
include(CTest)

# --- Third-party (vendored) ----------------------------------------------
add_subdirectory(third_party/cjson)

# --- Components -----------------------------------------------------------
add_subdirectory(core)
add_subdirectory(drivers)

if(QUAERO_BUILD_APP)
  add_subdirectory(app)
endif()
