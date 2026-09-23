#!/usr/bin/env bash
# Build the Squaero Windows MSI (issue #40). Reproducible, no CI required.
#
# Prerequisites (one-time):
#   dotnet tool install --global wix          # WiX CLI (v5+)
#   wix extension add -g WixToolset.UI.wixext # the WixUI dialog set
#
# The release is x64 (issue #560). x86 was forced by IBM's 32-bit Informix
# client until #557 (Informix now speaks DRDA) and still builds: pass x86.
#
# Staging: build-<arch>/app/ must contain the app + its runtime DLLs + drivers/.
# Build it first with the matching toolchain (cmake/toolchain-x86_64-mingw.cmake
# or cmake/toolchain-i686-mingw.cmake). Every client library is fetched and
# built from source by CMake — no manual client library needed:
#   pnpm --dir frontend build
#   cmake -S . -B build-x64 -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-x86_64-mingw.cmake \
#     -DQUAERO_BUILD_APP=ON -DQUAERO_SSH=ON -DQUAERO_MARIADB=ON -DQUAERO_MONGOC=ON \
#     -DQUAERO_LIBPQ=ON -DQUAERO_FREETDS=ON
#   cmake --build build-x64
# The CMake staging places the driver plugins and the MinGW runtime DLLs next to
# squaero.exe automatically (the MariaDB client is linked statically into
# mysql.dll, so there is no separate client DLL to ship).
#
# Usage: installer/build-msi.sh [version] [arch]   (defaults: ./VERSION, x64)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
ARCH="${2:-x64}"
export PATH="$HOME/.dotnet/tools:$PATH"

OUT="dist/squaero-${VERSION}-${ARCH}.msi"
mkdir -p dist
echo "Building $OUT (version $VERSION.0)"
wix build installer/quaero.wxs \
  -ext WixToolset.UI.wixext \
  -arch "$ARCH" \
  -d "Version=${VERSION}.0" \
  -o "$OUT"
echo "Done: $OUT"
