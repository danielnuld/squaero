#!/usr/bin/env bash
# Build the Quaero Windows MSI (issue #40). Reproducible, no CI required.
#
# Prerequisites (one-time):
#   dotnet tool install --global wix          # WiX CLI (v5+)
#   wix extension add -g WixToolset.UI.wixext # the WixUI dialog set
#
# The release is x86 (32-bit): the IBM Informix ODBC driver is 32-bit only and
# Quaero loads drivers in-process, so the whole app must be x86 to support it.
#
# Staging: build-x86/app/ must contain the app + its runtime DLLs + drivers/.
# Build it first with the i686 toolchain (see cmake/toolchain-i686-mingw.cmake).
# The MySQL client (32-bit MariaDB Connector/C), SSH (libssh2) and MongoDB
# (mongo-c-driver) are all fetched and built from source by CMake — no manual
# client library needed:
#   pnpm --dir frontend build
#   cmake -S . -B build-x86 -DCMAKE_TOOLCHAIN_FILE=cmake/toolchain-i686-mingw.cmake \
#     -DQUAERO_SSH=ON -DQUAERO_MARIADB=ON -DQUAERO_MONGOC=ON
#   cmake --build build-x86 --target quaero
# The CMake staging places the driver plugins and the MinGW runtime DLLs next to
# quaero.exe automatically (the MariaDB client is linked statically into
# mysql.dll, so there is no separate client DLL to ship).
#
# Usage: installer/build-msi.sh [version]   (default: contents of ./VERSION)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
export PATH="$HOME/.dotnet/tools:$PATH"

OUT="dist/quaero-${VERSION}-x86.msi"
mkdir -p dist
echo "Building $OUT (version $VERSION.0)"
wix build installer/quaero.wxs \
  -ext WixToolset.UI.wixext \
  -arch x86 \
  -d "Version=${VERSION}.0" \
  -o "$OUT"
echo "Done: $OUT"
