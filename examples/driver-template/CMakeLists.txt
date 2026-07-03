# Example / template driver.
#
# This builds two ways:
#
#   * In-tree — Quaero's top-level build adds this directory (see the root
#     CMakeLists) and the SDK target `quaero::driver_sdk` already exists, so CI
#     compiles the template under the same strict warnings as the real drivers.
#
#   * Out-of-tree — a third party copies this folder, installs the Quaero driver
#     SDK (`cmake --install` of the main project, or a package), and builds it
#     standalone. Then the target does not exist yet, so we find the installed
#     package. This is the path a real driver author takes.
#
cmake_minimum_required(VERSION 3.20)
project(quaero-driver-template
  VERSION 0.1.0
  DESCRIPTION "Minimal Quaero database driver, ready to copy"
  LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# When built standalone, pull in the installed SDK (headers + the interface
# target). In-tree the target is already defined by the parent build.
if(NOT TARGET quaero::driver_sdk)
  find_package(QuaeroDriverSDK REQUIRED)
endif()

# A driver is a shared MODULE: the core loads it with dlopen/LoadLibrary at
# runtime. It links ONLY the SDK (the driver.h contract) — never the core.
add_library(example_driver MODULE
  src/entry.c
  src/driver.c)
target_include_directories(example_driver PRIVATE src)
target_link_libraries(example_driver PRIVATE quaero::driver_sdk)

# Plugin file name is "example.<ext>" (no lib prefix) so the loader's candidate
# rule and a clean engine name both hold.
set_target_properties(example_driver PROPERTIES PREFIX "" OUTPUT_NAME "example")

# Apply the project's strict warnings when building in-tree; standalone builds
# just use the compiler defaults (the helper is not installed).
if(COMMAND quaero_set_warnings)
  quaero_set_warnings(example_driver)
endif()
