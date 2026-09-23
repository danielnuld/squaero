# Toolchain: 32-bit Windows (x86 / i686) via standalone MinGW-w64.
#
# The Windows release was x86 while the Informix driver loaded IBM's 32-bit
# Client SDK in-process. #557 replaced it with DRDA and #560 moved the release
# to x64 (cmake/toolchain-x86_64-mingw.cmake); this one still builds and CI
# keeps it green, but its MSI (installer/build-msi.sh <v> x86) is not published.
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
