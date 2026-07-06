# Fetch and build mongo-c-driver (libmongoc + libbson) and link it statically
# into the MongoDB plugin. Enabled with -DQUAERO_MONGOC=ON when no system
# libmongoc is available (e.g. Windows without pkg-config). Mirrors the libssh2
# approach (cmake/QuaeroLibssh2.cmake).
#
# Static link => the plugin (mongodb.dll) carries libmongoc/libbson inside it, so
# there are no extra runtime DLLs to ship (only Windows system libs). On Windows
# the TLS backend is Secure Channel (built in), so no OpenSSL is required.

include(FetchContent)

function(quaero_enable_mongoc target)
  set(_saved_build_testing "${BUILD_TESTING}")
  # mongo-c-driver uses some GNU extensions; build it with -std=gnu11 (scoped to
  # its subdirectory, not our targets which are already defined).
  set(CMAKE_C_EXTENSIONS ON)

  # Static-only, no tests/examples, minimal optional deps.
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(ENABLE_STATIC ON CACHE STRING "" FORCE)
  set(ENABLE_SHARED OFF CACHE BOOL "" FORCE)
  set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
  set(ENABLE_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
  set(ENABLE_SASL OFF CACHE STRING "" FORCE)
  set(ENABLE_ZLIB OFF CACHE STRING "" FORCE)
  set(ENABLE_ZSTD OFF CACHE STRING "" FORCE)
  set(ENABLE_SNAPPY OFF CACHE STRING "" FORCE)
  set(ENABLE_ICU OFF CACHE BOOL "" FORCE)
  set(ENABLE_SRV OFF CACHE STRING "" FORCE)
  set(ENABLE_AUTOMATIC_INIT_AND_CLEANUP OFF CACHE BOOL "" FORCE)
  set(MONGO_USE_CCACHE OFF CACHE BOOL "" FORCE)
  if(WIN32)
    set(ENABLE_SSL WINDOWS CACHE STRING "" FORCE)
  else()
    set(ENABLE_SSL OPENSSL CACHE STRING "" FORCE)
  endif()

  FetchContent_Declare(mongoc
    GIT_REPOSITORY https://github.com/mongodb/mongo-c-driver.git
    GIT_TAG 1.30.1
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(mongoc)

  set(BUILD_TESTING "${_saved_build_testing}" CACHE BOOL "" FORCE)

  # Treat the driver's headers as SYSTEM for consumers so mongoc/libbson headers
  # do not trip our -Werror policy.
  foreach(_t mongoc_static bson_static)
    if(TARGET ${_t})
      set_target_properties(${_t} PROPERTIES SYSTEM ON)
    endif()
  endforeach()

  target_link_libraries(${target} PRIVATE mongoc_static)
  # Static libmongoc/libbson: tell their headers not to expect dllimport.
  target_compile_definitions(${target} PRIVATE MONGOC_STATIC BSON_STATIC)
  if(WIN32)
    target_link_libraries(${target} PRIVATE
      ws2_32 secur32 crypt32 bcrypt dnsapi)
  endif()
endfunction()
