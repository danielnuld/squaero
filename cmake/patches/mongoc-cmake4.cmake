# FetchContent PATCH_COMMAND for mongo-c-driver 1.30 (see cmake/QuaeroMongoc.cmake).
# Two things CMake 4 rejects, found building for iOS (#573). Idempotent.
# Invoked with -DMONGOC_SRC=<SOURCE_DIR>.
#
# 1. libbson sets CMP0042 (MACOSX_RPATH) to OLD on Apple, and CMake 4 removed the
#    OLD behaviour of every policy older than 3.5. The static libraries we build
#    have no rpath to care about, so the line is dropped.
# 2. The try_compile that probes accept()'s argument types passes "-Werror ..."
#    as CMAKE_FLAGS, which CMake 4 reads as a warning category and fails on. The
#    flags only skipped linking the probe; without them it links, and still
#    finds struct sockaddr / socklen_t.

set(_path "${MONGOC_SRC}/src/libbson/CMakeLists.txt")
file(READ "${_path}" _contents)
string(REPLACE "cmake_policy (SET CMP0042 OLD)" "" _contents "${_contents}")
file(WRITE "${_path}" "${_contents}")

set(_path "${MONGOC_SRC}/src/libmongoc/CMakeLists.txt")
file(READ "${_path}" _contents)
string(REGEX REPLACE "CMAKE_FLAGS[ \t\r\n]*\"-Werror -DCMAKE_CXX_LINK_EXECUTABLE='echo not linking now...'\"" ""
  _contents "${_contents}")
file(WRITE "${_path}" "${_contents}")
