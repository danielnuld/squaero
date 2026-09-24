#!/bin/sh
# Build SquaeroCore.xcframework: the core, the static drivers and every client
# library they need, for the iPhone and its simulator (issue #573).
#
#   scripts/ios/build-xcframework.sh [out-dir]      (default: build-ios)
#
# Needs a Mac with Xcode, CMake and Ninja. Each platform is built in
# <out-dir>/<device|simulator>; an existing build there is reused.
#
# The archives merged are exactly those static_registry_test links, so the list
# follows whatever drivers the configuration built. A probe program is then
# linked against the merged library alone, per platform: it fails on any
# missing symbol, and otool shows it needs nothing outside the iOS SDK.

set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:-"$root/build-ios"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
min=17.0

rm -rf "$out/include" "$out/SquaeroCore.xcframework"
mkdir -p "$out/include"
cp -R "$root/core/include/dbcore" "$out/include/"
cp "$root/drivers/static/static_drivers.h" "$out/include/"

cat > "$out/probe.c" <<'EOF'
#include <stdio.h>
#include "static_drivers.h"
#include "dbcore/ipc.h"

int main(void)
{
    char *res;
    printf("drivers: %d\n", quaero_register_static_drivers(dbcore_runtime_get()));
    res = dbcore_ipc_handle("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"app.hello\"}");
    printf("%s\n", res ? res : "(null)");
    dbcore_ipc_free(res);
    return 0;
}
EOF

for p in device simulator; do
  b="$out/$p"
  if [ ! -f "$b/build.ninja" ]; then
    cmake -S "$root" -B "$b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_TOOLCHAIN_FILE="$root/cmake/toolchain-ios.cmake" \
      -DQUAERO_IOS_PLATFORM=$p -DQUAERO_IOS_MIN=$min \
      -DQUAERO_BUILD_APP=OFF -DQUAERO_BUILD_TOOLS=OFF -DQUAERO_BUILD_EXAMPLES=OFF \
      -DQUAERO_STATIC_DRIVERS=ON -DQUAERO_SSH=ON
  fi
  cmake --build "$b"

  # The test's link line, relative to the build dir: its .a files, in order.
  link=$(cd "$b" && ninja -t commands drivers/static_registry_test | tail -n 1)
  libs=$(echo "$link" | tr ' ' '\n' | grep '\.a$' | sed "s|^|$b/|")
  # System libraries and frameworks: the app has to link these too.
  sys=$(echo "$link" | grep -oE -- '-framework [^ ]+|-l[a-z0-9_]+' | tr '\n' ' ' || true)
  echo "== $p: merging"
  echo "$libs" | sed "s|^$b/|  |"
  # Apple's libtool warns about object files that share a name across
  # archives; they are distinct members, so the warning is noise.
  # shellcheck disable=SC2086
  libtool -static -no_warning_for_no_symbols -o "$b/libSquaeroCore.a" $libs \
    2> "$b/libtool.log"
  grep -v "same member name" "$b/libtool.log" || true

  if [ $p = simulator ]; then
    sdk=iphonesimulator; target=arm64-apple-ios$min-simulator
  else
    sdk=iphoneos; target=arm64-apple-ios$min
  fi
  # shellcheck disable=SC2086
  xcrun -sdk $sdk clang -target "$target" -I "$out/include" "$out/probe.c" \
    "$b/libSquaeroCore.a" $sys -o "$b/probe"
  echo "== $p: system libraries the app must link: ${sys:-none}"
  echo "== $p: probe links against"
  otool -L "$b/probe" | tail -n +2
  if otool -L "$b/probe" | tail -n +2 | grep -v -E '^\s+/(usr/lib|System/Library)/'; then
    echo "error: the probe needs a library outside the iOS SDK (above)" >&2
    exit 1
  fi
done

xcodebuild -create-xcframework \
  -library "$out/device/libSquaeroCore.a" -headers "$out/include" \
  -library "$out/simulator/libSquaeroCore.a" -headers "$out/include" \
  -output "$out/SquaeroCore.xcframework"

echo "== sizes"
du -sh "$out/device/libSquaeroCore.a" "$out/simulator/libSquaeroCore.a" \
  "$out/SquaeroCore.xcframework"
# What an app actually carries: the probe pulls in every driver and client.
ls -l "$out/device/probe" | awk '{printf "device probe (all drivers linked): %d KB\n", $5 / 1024}'
