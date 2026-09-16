#!/usr/bin/env bash
# Build the Squaero .deb for Linux (issue #40). Reproducible, no CI required.
#
# Prerequisites: a Linux build of the app with its drivers staged in build/app/.
# Ubuntu 24.04 packages (the release job installs the same):
#   sudo apt-get install build-essential cmake ninja-build pkg-config \
#     libgtk-4-dev libwebkitgtk-6.0-dev libmariadb-dev libpq-dev libmongoc-dev \
#     unixodbc-dev libssl-dev
#   pnpm --dir frontend build
#   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
#     -DQUAERO_SSH=ON -DQUAERO_FREETDS=ON -DWEBVIEW_WEBKITGTK_API=6.0
#   cmake --build build --target quaero
# The system FreeTDS on 24.04 is too old for the SQL Server plugin (it needs
# 1.4+), hence QUAERO_FREETDS, which links a static db-lib into it. The WebKitGTK
# API is pinned because webview 0.12 forgets it on a re-configure and goes
# looking for GTK 3.
#
# Layout: the executable and drivers/ stay side by side under /usr/lib/squaero,
# because the app finds its plugins next to the file it runs from (it resolves
# /proc/self/exe, so the /usr/bin symlink is followed). The Depends line is
# whatever dpkg-shlibdeps finds the binaries linking — every driver's client
# library included, so every engine works right after installing. Informix
# still needs IBM's Client SDK, which is proprietary and not packaged. The
# emoji font is only recommended: without it a few buttons (Chart) lose their
# icon, measured on a bare Ubuntu 24.04.
#
# Usage: installer/build-deb.sh [version]   (default: ./VERSION)
#        → dist/squaero_<version>_<arch>.deb
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(tr -d '\r\n' < VERSION)}"
ARCH="$(dpkg --print-architecture)"
APP="$PWD/build/app"
ROOT="$PWD/build/deb-root"
LIB="$ROOT/usr/lib/squaero"

[ -x "$APP/squaero" ] || { echo "no $APP/squaero — build the app first" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/DEBIAN" "$LIB/drivers" "$ROOT/usr/bin" \
  "$ROOT/usr/share/applications" "$ROOT/usr/share/doc/squaero"

install -m 755 "$APP/squaero" "$LIB/"
install -m 644 "$APP"/drivers/*.so "$LIB/drivers/"
strip --strip-unneeded "$LIB/squaero" "$LIB"/drivers/*.so
ln -s ../lib/squaero/squaero "$ROOT/usr/bin/squaero"

# tr: a Windows checkout may have given the desktop file CRLF endings.
tr -d '\r' < assets/icons/quaero.desktop > "$ROOT/usr/share/applications/squaero.desktop"
for dir in assets/icons/hicolor/*x*; do
  install -D -m 644 "$dir/apps/quaero.png" \
    "$ROOT/usr/share/icons/hicolor/$(basename "$dir")/apps/squaero.png"
done
install -m 644 LICENSE "$ROOT/usr/share/doc/squaero/copyright"

# dpkg-shlibdeps insists on running inside a source tree with debian/control.
SHLIBS="$PWD/build/deb-shlibs"
rm -rf "$SHLIBS" && mkdir -p "$SHLIBS/debian" && touch "$SHLIBS/debian/control"
DEPENDS="$(cd "$SHLIBS" && dpkg-shlibdeps -O -e"$LIB/squaero" \
  $(for so in "$LIB"/drivers/*.so; do printf -- '-e%s ' "$so"; done) \
  | sed -n 's/^shlibs:Depends=//p')"
[ -n "$DEPENDS" ] || { echo "dpkg-shlibdeps found no dependencies" >&2; exit 1; }

cat > "$ROOT/DEBIAN/control" <<EOF
Package: squaero
Version: $VERSION
Architecture: $ARCH
Maintainer: Daniel Noé <daniel.nuld@gmail.com>
Installed-Size: $(du -sk "$ROOT/usr" | cut -f1)
Depends: $DEPENDS
Recommends: fonts-noto-color-emoji
Section: database
Priority: optional
Homepage: https://danielnuld.github.io/squaero/
Description: Modern, lightweight, multi-engine database client
 SQLite, MySQL/MariaDB, PostgreSQL, Informix, MongoDB and SQL Server from one
 native window. Informix also needs IBM's Informix Client SDK, installed
 separately.
EOF

mkdir -p dist
OUT="dist/squaero_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$ROOT" "$OUT"
echo "built $OUT"
