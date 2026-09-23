# Toolchain: 64-bit Windows (x64 / x86_64) via standalone MinGW-w64 — the
# Windows release since issue #560. The x86 build (toolchain-i686-mingw.cmake)
# had been forced by IBM's 32-bit Informix Client SDK, gone since #557.
#
# Usage:
#   cmake -S . -B build-x64 -G Ninja \
#         -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-x86_64-mingw.cmake
#
# Override the MinGW location with -DMINGW64_ROOT=<path> if it is not the
# default below (winlibs x86_64 GCC 13.2.0, UCRT runtime, posix threads, SEH —
# the same release as the i686 toolchain).

set(MINGW64_ROOT "C:/mingw64" CACHE PATH "Root of the 64-bit MinGW-w64 toolchain")

set(CMAKE_C_COMPILER   "${MINGW64_ROOT}/bin/gcc.exe")
set(CMAKE_CXX_COMPILER "${MINGW64_ROOT}/bin/g++.exe")
set(CMAKE_RC_COMPILER  "${MINGW64_ROOT}/bin/windres.exe")

# Prefer the toolchain's own sysroot when resolving libraries/headers.
set(CMAKE_FIND_ROOT_PATH "${MINGW64_ROOT}/x86_64-w64-mingw32")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
