#!/usr/bin/env bash
# Build the Squaero Windows MSI (issue #40). Reproducible, no CI required.
#
# Prerequisites (one-time):
#   dotnet tool install --global wix          # WiX CLI (v5+)
#   wix extension add -g WixToolset.UI.wixext # the WixUI dialog set
#
# The release is x86 (32-bit): the IBM Informix ODBC driver is 32-bit only and
# Squaero loads drivers in-process, so the whole app must be x86 to support it.
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
# squaero.exe automatically (the MariaDB client is linked statically into
# mysql.dll, so there is no separate client DLL to ship).
#
# Informix client: if a 32-bit IBM Informix Client SDK is installed on THIS
# machine, its tree is bundled into the MSI (see the CsdkStage block in
# quaero.wxs) so the group does not need IBM's installer. Without one — CI, for
# instance — the MSI is just the app. Pass --no-csdk to skip it deliberately.
#
# Usage: installer/build-msi.sh [version] [--no-csdk]   (default: ./VERSION)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
export PATH="$HOME/.dotnet/tools:$PATH"

CSDK_ARGS=()
STAGE="$PWD/build-x86/csdk-stage"
rm -rf "$STAGE"
if [ "${2:-}" != "--no-csdk" ]; then
  # MSYS_NO_PATHCONV keeps Git Bash from rewriting the registry key and /flags.
  RAW=$(MSYS_NO_PATHCONV=1 reg query 'HKLM\SOFTWARE\WOW6432Node\Informix\Environment' /v INFORMIXDIR 2>/dev/null |
        sed -n 's/.*REG_SZ[[:space:]]*//p' | tr -d '[:cntrl:]') || RAW=""
  SRC=""
  [ -n "$RAW" ] && SRC=$(cygpath "$RAW") && SRC=${SRC%/}
  if [ -n "$SRC" ] && [ -f "$SRC/bin/iclit09b.dll" ]; then
    # OAT, the bundled JRE, demos and the uninstaller are ~400 MB the ODBC
    # driver never touches. robocopy exits 1 on "files copied": only >=8 fails.
    echo "Bundling the Informix Client SDK from $SRC"
    MSYS_NO_PATHCONV=1 robocopy "$(cygpath -w "$SRC")" "$(cygpath -w "$STAGE")" \
      /E /NFL /NDL /NJH /NJS /NP /XD OAT jvm demo uninstall tmp /XF '*.log' >/dev/null || [ $? -lt 8 ]
    CSDK_ARGS=(-d "CsdkStage=$(cygpath -w "$STAGE")")
  else
    echo "No 32-bit Informix Client SDK here: building the app-only MSI"
  fi
fi

OUT="dist/squaero-${VERSION}-x86.msi"
mkdir -p dist
echo "Building $OUT (version $VERSION.0)"
wix build installer/quaero.wxs \
  -ext WixToolset.UI.wixext \
  -arch x86 \
  -d "Version=${VERSION}.0" \
  "${CSDK_ARGS[@]+"${CSDK_ARGS[@]}"}" \
  -o "$OUT"
rm -rf "$STAGE"
echo "Done: $OUT"
