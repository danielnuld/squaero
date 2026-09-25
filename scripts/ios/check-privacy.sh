#!/bin/sh
# Checks the privacy manifest against the app (issue #579, task 7.2): every
# required-reason API the app binary imports must have its category declared
# in PrivacyInfo.xcprivacy, so a change that starts using one fails here
# instead of in App Review.
#
#   scripts/ios/check-privacy.sh path/to/Squaero.app
#
# The binary's undefined symbols are what the app (core and drivers included,
# they are linked statically) calls in the system; Apple's list of
# required-reason APIs names them by category.

set -eu

app=$1
bin="$app/$(basename "$app" .app)"
manifest="$app/PrivacyInfo.xcprivacy"
[ -f "$bin" ] || { echo "no binary at $bin"; exit 1; }
[ -f "$manifest" ] || { echo "no PrivacyInfo.xcprivacy in $app"; exit 1; }

# A Debug build keeps the app's code in <name>.debug.dylib, next to a stub.
dylib="$app/$(basename "$app" .app).debug.dylib"
[ -f "$dylib" ] && bin="$bin $dylib"
# shellcheck disable=SC2086
symbols=$(for b in $bin; do nm -u "$b"; done | sed 's/^ *U //' | sort -u)
declared=$(plutil -extract NSPrivacyAccessedAPITypes json -o - "$manifest")

# category|symbols (extended regex over the undefined symbols)
checks='NSPrivacyAccessedAPICategoryFileTimestamp|^_(stat|fstat|fstatat|lstat|getattrlist|getattrlistbulk|fgetattrlist|getattrlistat)(\$INODE64)?$
NSPrivacyAccessedAPICategorySystemBootTime|^_mach_absolute_time$
NSPrivacyAccessedAPICategoryDiskSpace|^_(statfs|fstatfs|statvfs|fstatvfs)(\$INODE64)?$
NSPrivacyAccessedAPICategoryUserDefaults|NSUserDefaults
NSPrivacyAccessedAPICategoryActiveKeyboards|activeInputModes'

echo "$checks" | while IFS='|' read -r category pattern; do
  used=$(echo "$symbols" | grep -E "$pattern" | tr '\n' ' ' || true)
  if [ -n "$used" ]; then
    if echo "$declared" | grep -q "\"$category\""; then
      echo "ok       $category ($used)"
    else
      echo "MISSING  $category, used by: $used"
      echo x >> "${TMPDIR:-/tmp}/privacy-missing.$$"
    fi
  elif echo "$declared" | grep -q "\"$category\""; then
    echo "unused   $category is declared but the binary does not call it"
  fi
done
if [ -f "${TMPDIR:-/tmp}/privacy-missing.$$" ]; then
  rm -f "${TMPDIR:-/tmp}/privacy-missing.$$"
  echo "Declare the missing categories, with their reasons, in ios/Squaero/Resources/PrivacyInfo.xcprivacy."
  exit 1
fi
