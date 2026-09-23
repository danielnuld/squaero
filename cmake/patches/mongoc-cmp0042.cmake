# FetchContent PATCH_COMMAND for mongo-c-driver 1.30 (see cmake/QuaeroMongoc.cmake).
#
# libbson sets CMP0042 (MACOSX_RPATH) to OLD on Apple, and CMake 4 removed the
# OLD behaviour of every policy older than 3.5: configuring for macOS or iOS
# stops there. The static libraries we build have no rpath to care about, so the
# line is simply dropped. Idempotent. Invoked with -DMONGOC_SRC=<SOURCE_DIR>.

set(_path "${MONGOC_SRC}/src/libbson/CMakeLists.txt")
file(READ "${_path}" _contents)
string(REPLACE "cmake_policy (SET CMP0042 OLD)" "" _contents "${_contents}")
file(WRITE "${_path}" "${_contents}")
