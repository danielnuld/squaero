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
# Informix client: the 32-bit IBM Informix Client SDK is bundled into the MSI
# (see the CsdkStage block in quaero.wxs) so the group does not need IBM's
# installer. It is taken from INFORMIX_CSDK, or from the CSDK installed on this
# machine. Without either the build FAILS: an MSI with no CSDK registers no ODBC
# driver and Informix connections die with IM002. Pass --no-csdk for an
# app-only MSI on purpose.
#
# Usage: installer/build-msi.sh [version] [--no-csdk]   (default: ./VERSION)
#        INFORMIX_CSDK=/path/to/csdk installer/build-msi.sh [version]
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
export PATH="$HOME/.dotnet/tools:$PATH"

CSDK_ARGS=()
STAGE="$PWD/build-x86/csdk-stage"
rm -rf "$STAGE"
if [ "${2:-}" != "--no-csdk" ]; then
  # INFORMIX_CSDK points at an unpacked CSDK tree: the release runner has no IBM
  # install and fetches one (see .github/workflows/release.yml). Otherwise use
  # the CSDK installed on this machine; MSYS_NO_PATHCONV keeps Git Bash from
  # rewriting the registry key and /flags.
  SRC="${INFORMIX_CSDK:-}"
  if [ -z "$SRC" ]; then
    RAW=$(MSYS_NO_PATHCONV=1 reg query 'HKLM\SOFTWARE\WOW6432Node\Informix\Environment' /v INFORMIXDIR 2>/dev/null |
          sed -n 's/.*REG_SZ[[:space:]]*//p' | tr -d '[:cntrl:]') || RAW=""
    [ -n "$RAW" ] && SRC=$(cygpath "$RAW")
  fi
  SRC=${SRC%/}
  # Failing beats the silent fallback this used to have: an MSI with no CSDK
  # registers no ODBC driver, so every machine without an IBM install fails to
  # connect with IM002 — which is exactly how the released MSIs shipped up to
  # v0.24.0. --no-csdk builds the app-only MSI deliberately.
  if [ -z "$SRC" ] || [ ! -f "$SRC/bin/iclit09b.dll" ]; then
    echo "error: no 32-bit Informix Client SDK at ${SRC:-<none>}." >&2
    echo "       Set INFORMIX_CSDK to an unpacked CSDK, or pass --no-csdk." >&2
    exit 1
  fi
  # OAT, the bundled JRE, demos and the uninstaller are ~400 MB the ODBC
  # driver never touches. robocopy exits 1 on "files copied": only >=8 fails.
  echo "Bundling the Informix Client SDK from $SRC"
  MSYS_NO_PATHCONV=1 robocopy "$(cygpath -w "$SRC")" "$(cygpath -w "$STAGE")" \
    /E /NFL /NDL /NJH /NJS /NP /XD OAT jvm demo uninstall tmp /XF '*.log' >/dev/null || [ $? -lt 8 ]
  CSDK_ARGS=(-d "CsdkStage=$(cygpath -w "$STAGE")")
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
