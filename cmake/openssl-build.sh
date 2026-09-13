#!/bin/sh
# Builds a static OpenSSL for the i686 MinGW toolchain (issue #144). Run by
# cmake/QuaeroOpenSSL.cmake at configure time, under Git for Windows' sh.
#
#   $1 OpenSSL source dir      $2 install prefix     $3 MinGW bin dir
#   $4 parallel jobs           $5 dir holding the pure-Perl modules to borrow
set -e
src=$(cygpath -u "$1")
prefix=$(cygpath -u "$2")
mingw=$(cygpath -u "$3")
mods=$(cygpath -u "$5")
# The toolchain first; /usr/bin (Git's) for sh, perl and the coreutils the
# generated makefile calls. OpenSSL's mingw target needs a perl that speaks Unix
# paths, which rules out Strawberry Perl even when it is on PATH.
export PATH="$mingw:/usr/bin:$PATH"
make=$(command -v make || command -v mingw32-make)

cd "$src"
# Git's perl lacks pure-Perl core modules OpenSSL's scripts load
# (Locale::Maketext::Simple, ExtUtils::MakeMaker, Pod::Usage); borrow them from
# another Perl install ($5: MSYS2's or Strawberry Perl's module tree).
# Two places, because two kinds of process need them:
#  - Configure and the configdata.pm it spawns: through PERL5LIB, pointing at a
#    directory holding ONLY these modules, so nothing of Git's perl is shadowed.
#    Set for Configure alone — a native make would rewrite the path to C:/…, and
#    perl splits PERL5LIB on that colon.
#  - the header-generation rules make runs: they call perl with -I., so the
#    source root.
borrowed="$src/.perl-borrowed"
mkdir -p "$borrowed"
for dest in "$borrowed" .; do
  cp -r "$mods/Locale" "$mods/ExtUtils" "$mods/Pod" "$dest/"
done

PERL5LIB="$borrowed" /usr/bin/perl Configure mingw no-shared no-tests no-asm no-module \
  --prefix="$prefix" --libdir=lib CC=gcc AR=ar RANLIB=ranlib RC=windres
"$make" -j"$4" build_libs
"$make" install_dev
