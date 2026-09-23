#!/usr/bin/env bash
# Build Squaero.app and its .dmg for macOS (issue #40). Apple Silicon (arm64).
#
# Prerequisites (Homebrew): the client libraries the drivers link and
# dylibbundler, which copies the non-system ones into the bundle:
#   brew install openssl@3 libpq mongo-c-driver@1 dylibbundler
#
# Build the app first. MariaDB, libssh2 and FreeTDS come from source and link
# statically; libpq and mongo-c-driver are Homebrew's and are bundled here
# (mongo-c 1.30 does not configure from source on macOS with CMake 4):
#   export PKG_CONFIG_PATH="$(brew --prefix mongo-c-driver@1)/lib/pkgconfig"
#   pnpm --dir frontend build
#   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
#     -DCMAKE_PREFIX_PATH="$(brew --prefix libpq);$(brew --prefix openssl@3)" \
#     -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" -DOPENSSL_USE_STATIC_LIBS=ON \
#     -DQUAERO_SSH=ON -DQUAERO_MARIADB=ON -DQUAERO_FREETDS=ON
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

# Every non-system library the executable and the plugins load goes into
# Frameworks/, with install names rewritten to find it there. A plugin is
# dlopen'ed by the executable, so @executable_path is Contents/MacOS for both.
fix=(-x "$APP/Contents/MacOS/squaero")
for plugin in "$APP"/Contents/MacOS/drivers/*; do
  fix+=(-x "$plugin")
done
dylibbundler -of -b "${fix[@]}" -d "$APP/Contents/Frameworks" \
  -p @executable_path/../Frameworks/

# dylibbundler can add the same LC_RPATH twice (it did to libmongoc), and
# dyld on macOS 15 refuses to load such a library: keep one of each.
for f in "$APP"/Contents/MacOS/squaero "$APP"/Contents/MacOS/drivers/* "$APP"/Contents/Frameworks/*; do
  otool -l "$f" | awk '/cmd LC_RPATH/{getline; getline; print $2}' | sort | uniq -d |
    while read -r rpath; do
      while [ "$(otool -l "$f" | awk '/cmd LC_RPATH/{getline; getline; print $2}' | grep -cxF "$rpath")" -gt 1 ]; do
        install_name_tool -delete_rpath "$rpath" "$f"
      done
    done
done

# The oldest macOS the bundle runs on is the newest any of its pieces needs
# (Homebrew's libraries are built for the runner's own macOS).
MINOS="$(for f in "$APP"/Contents/MacOS/squaero "$APP"/Contents/MacOS/drivers/* "$APP"/Contents/Frameworks/*; do
  otool -l "$f" | awk '/LC_BUILD_VERSION/{b=1} b && $1=="minos"{print $2; b=0}'
done | sort -t. -k1,1n -k2,2n | tail -1)"
sed -e "s/@VERSION@/$VERSION/g" -e "s/@MINOS@/$MINOS/g" installer/Info.plist.in   > "$APP/Contents/Info.plist"
echo "Minimum macOS: $MINOS"

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
