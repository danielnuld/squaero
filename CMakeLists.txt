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

# Driver plugins are shared modules that link the vendored static libs
# (sqlite3, cJSON) and the core. On ELF targets every object pulled into a
# shared object must be position-independent, so build all static code PIC.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# The webview app needs platform GUI dev packages (GTK4/WebKitGTK on Linux,
# WebView2 on Windows, WebKit on macOS). Turn this off to build only the core
# and its tests on a machine without those.
option(QUAERO_BUILD_APP "Build the native webview application shell" ON)

# SSH-tunnel support. OFF by default so the standard build stays dependency-free
# and green; when ON, the core fetches libssh2 (with a platform crypto backend)
# and compiles the real port-forward. Without it, a DSN that asks for an SSH
# tunnel fails with an explicit "not built" error (see core/src/conn/ssh_tunnel.c).
option(QUAERO_SSH "Build SSH-tunnel support (fetches libssh2)" OFF)

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
add_subdirectory(third_party/sqlite)

# Build the example/template driver (examples/). ON by default so CI compiles
# it under the project warnings; a lean core-only build can turn it off.
option(QUAERO_BUILD_EXAMPLES "Build the example driver template" ON)

# --- Components -----------------------------------------------------------
add_subdirectory(core)
add_subdirectory(drivers)

# --- Driver SDK (installable, versioned) ---------------------------------
# The public contract a third-party driver compiles against is a single header,
# dbcore/driver.h. Expose it as a header-only INTERFACE target and install it as
# a versioned CMake package so an out-of-tree driver can `find_package`. The
# core is GPL and is NOT part of the SDK — a driver depends only on the ABI.
add_library(quaero_driver_sdk INTERFACE)
add_library(quaero::driver_sdk ALIAS quaero_driver_sdk)
# Export under the short name so the installed package's imported target is
# `quaero::driver_sdk` too — matching the in-tree alias above, so the example's
# CMakeLists links the same name whether built in-tree or standalone.
set_target_properties(quaero_driver_sdk PROPERTIES EXPORT_NAME driver_sdk)
target_include_directories(quaero_driver_sdk INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/core/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(quaero_driver_sdk INTERFACE c_std_11)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

install(TARGETS quaero_driver_sdk EXPORT QuaeroDriverSDKTargets)
install(FILES core/include/dbcore/driver.h
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/dbcore)
install(EXPORT QuaeroDriverSDKTargets
  NAMESPACE quaero::
  FILE QuaeroDriverSDKTargets.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/QuaeroDriverSDK)

configure_package_config_file(
  cmake/QuaeroDriverSDKConfig.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/QuaeroDriverSDKConfig.cmake"
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/QuaeroDriverSDK)
# The package version tracks the Quaero release; runtime compatibility is the
# separate DBC_ABI_VERSION check the loader applies (see driver.h).
write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/QuaeroDriverSDKConfigVersion.cmake"
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion)
install(FILES
  "${CMAKE_CURRENT_BINARY_DIR}/QuaeroDriverSDKConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/QuaeroDriverSDKConfigVersion.cmake"
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/QuaeroDriverSDK)

# Example driver — built against the SDK target above (defined before this so
# the in-tree example can link it). Also serves as the copy-ready template.
if(QUAERO_BUILD_EXAMPLES)
  add_subdirectory(examples)
endif()

# Cross-component integration tests (core + a real driver). Added after both so
# their targets exist for the test to depend on / load.
if(BUILD_TESTING)
  add_subdirectory(tests/integration)
endif()

if(QUAERO_BUILD_APP)
  add_subdirectory(app)
endif()
