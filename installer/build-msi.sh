#!/usr/bin/env bash
# Build the Quaero Windows MSI (issue #40). Reproducible, no CI required.
#
# Prerequisites (one-time):
#   dotnet tool install --global wix          # WiX CLI (v5+)
#   wix extension add -g WixToolset.UI.wixext # the WixUI dialog set
#
# Staging: build/app/ must contain the app + its runtime DLLs + drivers/. Build
# it first with:  pnpm --dir frontend build && cmake -S . -B build && \
#   cmake --build build --target quaero  (then stage the MinGW runtime DLLs and
#   the mysql client next to quaero.exe — see docs).
#
# Usage: installer/build-msi.sh [version]   (default: contents of ./VERSION)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
export PATH="$HOME/.dotnet/tools:$PATH"

OUT="dist/quaero-${VERSION}-x64.msi"
mkdir -p dist
echo "Building $OUT (version $VERSION.0)"
wix build installer/quaero.wxs \
  -ext WixToolset.UI.wixext \
  -arch x64 \
  -d "Version=${VERSION}.0" \
  -o "$OUT"
echo "Done: $OUT"
