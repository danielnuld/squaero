# Toolchain: 32-bit Windows (x86 / i686) via standalone MinGW-w64.
#
# Why x86: the IBM Informix Client SDK on this machine is 32-bit only, and
# Windows cannot load a 32-bit driver DLL into a 64-bit host process. Quaero
# loads driver plugins in-process (LoadLibraryA), so the whole app — shell,
# core, every driver and vendored lib — must be built x86 to use that CSDK.
#
# Usage:
#   cmake -S . -B build-x86 -G Ninja \
#         -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-i686-mingw.cmake
#
# Override the MinGW location with -DMINGW32_ROOT=<path> if it is not the
# default below (winlibs i686 GCC 13.2.0, UCRT runtime — matches the warning
# behavior of the 64-bit GCC 13.2.0 used elsewhere).

set(MINGW32_ROOT "C:/mingw32" CACHE PATH "Root of the 32-bit MinGW-w64 toolchain")

set(CMAKE_C_COMPILER   "${MINGW32_ROOT}/bin/gcc.exe")
set(CMAKE_CXX_COMPILER "${MINGW32_ROOT}/bin/g++.exe")
set(CMAKE_RC_COMPILER  "${MINGW32_ROOT}/bin/windres.exe")

# Prefer the toolchain's own sysroot when resolving libraries/headers.
set(CMAKE_FIND_ROOT_PATH "${MINGW32_ROOT}/i686-w64-mingw32")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE BOTH)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
