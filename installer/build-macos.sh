#!/usr/bin/env bash
# Build Squaero.app and its .dmg for macOS (issue #40). Apple Silicon (arm64).
#
# Prerequisites (Homebrew): the client libraries the drivers link and
# dylibbundler, which copies the non-system ones into the bundle:
#   brew install openssl@3 libpq dylibbundler
#
# Build the app first (MariaDB, mongo-c, libssh2 and FreeTDS come from source
# and link statically; libpq is Homebrew's and is bundled here):
#   pnpm --dir frontend build
#   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
#     -DCMAKE_PREFIX_PATH="$(brew --prefix libpq);$(brew --prefix openssl@3)" \
#     -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" -DOPENSSL_USE_STATIC_LIBS=ON \
#     -DQUAERO_SSH=ON -DQUAERO_MARIADB=ON -DQUAERO_MONGOC=ON -DQUAERO_FREETDS=ON
#   cmake --build build
#
# Signing: ad hoc only (no Apple Developer ID yet), so Gatekeeper asks the user
# to confirm the first launch (right click > Open).
#
# Usage: installer/build-macos.sh [version]   (default: ./VERSION)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(cat VERSION)}"
BUILD="${BUILD:-build}"
ARCH="$(uname -m)"

STAGE="dist/macos"
APP="$STAGE/Squaero.app"
rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"

cp "$BUILD/app/squaero" "$APP/Contents/MacOS/"
# The shell scans <exe_dir>/drivers for plugins.
cp -R "$BUILD/app/drivers" "$APP/Contents/MacOS/"
cp assets/icons/quaero.icns "$APP/Contents/Resources/squaero.icns"
sed "s/@VERSION@/$VERSION/g" installer/Info.plist.in > "$APP/Contents/Info.plist"

# Every non-system library the executable and the plugins load goes into
# Frameworks/, with install names rewritten to find it there. A plugin is
# dlopen'ed by the executable, so @executable_path is Contents/MacOS for both.
fix=(-x "$APP/Contents/MacOS/squaero")
for plugin in "$APP"/Contents/MacOS/drivers/*; do
  fix+=(-x "$plugin")
done
dylibbundler -of -b "${fix[@]}" -d "$APP/Contents/Frameworks" \
  -p @executable_path/../Frameworks/

# Nothing may still point into Homebrew: that would only work on this machine.
if otool -L "$APP"/Contents/MacOS/squaero "$APP"/Contents/MacOS/drivers/* \
    "$APP"/Contents/Frameworks/* 2>/dev/null | grep -E "/(opt|usr/local)/"; then
  echo "error: the bundle still links libraries outside it" >&2
  exit 1
fi

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# The disk image: the app plus a link to /Applications to drag it onto.
ln -s /Applications "$STAGE/Applications"
OUT="dist/squaero-${VERSION}-${ARCH}.dmg"
rm -f "$OUT"
hdiutil create -volname Squaero -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "Done: $OUT"
