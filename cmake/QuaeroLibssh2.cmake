# Fetch libssh2 and link it into a target for SSH-tunnel support.
#
# Called only when the QUAERO_SSH option is ON. libssh2 is built as a static
# library with a platform crypto backend that needs no extra vendored dependency:
# WinCNG (built into Windows) on Windows, the system OpenSSL elsewhere.
#
# libssh2's CMakeLists declares an older cmake_minimum_required, so inside its
# scope policy CMP0077 is OLD and option() overrides plain variables. We must
# therefore steer its build through CACHE variables, not normal ones. BUILD_TESTING
# is the one cache var we must not leave flipped (it also gates OUR tests), so we
# save and restore it around the fetch.

include(FetchContent)

function(quaero_enable_libssh2 target)
  set(_saved_build_testing "${BUILD_TESTING}")

  # Our project compiles with strict ISO C (CMAKE_C_EXTENSIONS OFF => -std=c11),
  # but libssh2's sources use BSD types (u_int/u_char) that glibc only exposes
  # under a GNU/_DEFAULT_SOURCE dialect. Build libssh2 with extensions ON so it
  # gets -std=gnu11; this normal variable is scoped to the libssh2 subdirectory
  # added below and does not affect our own targets (already created).
  set(CMAKE_C_EXTENSIONS ON)

  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
  set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
  set(ENABLE_ZLIB_COMPRESSION OFF CACHE BOOL "" FORCE)

  if(WIN32)
    set(CRYPTO_BACKEND "WinCNG" CACHE STRING "" FORCE)
  else()
    find_package(OpenSSL REQUIRED)
    set(CRYPTO_BACKEND "OpenSSL" CACHE STRING "" FORCE)
  endif()

  FetchContent_Declare(libssh2
    GIT_REPOSITORY https://github.com/libssh2/libssh2.git
    GIT_TAG libssh2-1.11.1
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(libssh2)

  # Restore BUILD_TESTING so our own test tree is still configured.
  set(BUILD_TESTING "${_saved_build_testing}" CACHE BOOL "" FORCE)

  target_link_libraries(${target} PRIVATE libssh2::libssh2)
  target_compile_definitions(${target} PRIVATE QUAERO_SSH)
  if(WIN32)
    # Our own listening/forward sockets use Winsock; libssh2's WinCNG backend
    # pulls bcrypt/crypt32 itself but we link them defensively.
    target_link_libraries(${target} PRIVATE ws2_32 bcrypt crypt32)
  endif()
endfunction()
