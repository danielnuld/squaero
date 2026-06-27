cmake_minimum_required(VERSION 3.20)

project(quaero
  VERSION 0.0.1
  DESCRIPTION "Modern, lightweight, multi-engine database client"
  LANGUAGES C)

# --- Language standard ---------------------------------------------------
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# --- Default build type (single-config generators) -----------------------
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

# --- Shared CMake helpers ------------------------------------------------
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(QuaeroWarnings)

# Defines BUILD_TESTING (default ON) and calls enable_testing().
include(CTest)

# --- Components -----------------------------------------------------------
add_subdirectory(core)
add_subdirectory(drivers)
add_subdirectory(app)
