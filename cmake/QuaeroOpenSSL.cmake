# Download and build OpenSSL (static) for the x86 Windows release, and expose it
# to the MySQL plugin (MariaDB Connector/C) and the PostgreSQL plugin (libpq),
# which until issue #144 had no TLS at all in the build that ships.
#
# OpenSSL is not a CMake project, and its mingw Configure needs a perl that speaks
# Unix paths plus a make: that is Git for Windows' perl and sh, a GNU make, and a
# few pure-Perl modules Git's perl lacks, borrowed from another Perl install
# (MSYS2's here; Strawberry Perl's on the windows-latest CI runner). The build runs once, at
# configure time — find_package(OpenSSL) in the MariaDB connector needs the result
# before any build step exists — and is reused until the version changes.
#
# Static link => each plugin carries the TLS code inside it: no DLL to ship.
# License: Apache-2.0, compatible with Squaero's GPLv3.
#
# Certificate verification: OpenSSL does not read the Windows certificate store,
# so verify_ca / verify-full need the CA file given in the connection's fields.

set(QUAERO_OPENSSL_VERSION "3.0.22")
set(QUAERO_OPENSSL_SHA256 "67ebca7e50d17383028045486653492195b83db95f8558709701bb47b5c1ef81")
set(_quaero_openssl_module_dir "${CMAKE_CURRENT_LIST_DIR}")

# Sets, in the caller's scope, the variables CMake's FindOpenSSL would set, so a
# consumer whose find_package(OpenSSL) is guarded by OPENSSL_FOUND (MariaDB
# Connector/C) takes these, and defines the imported targets quaero_openssl_ssl /
# quaero_openssl_crypto for our own linking. Safe to call from several plugins.
function(quaero_enable_openssl)
  set(_root "${CMAKE_BINARY_DIR}/_deps/openssl")
  set(_prefix "${_root}/install")
  set(_stamp "${_prefix}/built-${QUAERO_OPENSSL_VERSION}")

  if(NOT EXISTS "${_stamp}")
    find_program(QUAERO_GIT_SH NAMES sh
      PATHS "C:/Program Files/Git/usr/bin" "C:/Program Files/Git/bin")
    # Where to borrow the pure-Perl modules Git's perl lacks. Any Perl install
    # carries them; the first directory holding all three wins. The GitHub
    # Windows runner has Strawberry Perl but no MSYS2 Perl tree.
    set(QUAERO_PERL_MODULES "" CACHE PATH
      "Directory with Locale/, ExtUtils/ and Pod/ Perl modules for the OpenSSL build")
    set(_perl_mods "")
    foreach(_dir "${QUAERO_PERL_MODULES}" "C:/msys64/usr/share/perl5/core_perl"
                 "C:/Strawberry/perl/lib")
      if(_dir AND EXISTS "${_dir}/Pod/Usage.pm" AND EXISTS "${_dir}/ExtUtils/MakeMaker.pm"
         AND EXISTS "${_dir}/Locale/Maketext/Simple.pm")
        set(_perl_mods "${_dir}")
        break()
      endif()
    endforeach()
    if(NOT QUAERO_GIT_SH OR NOT _perl_mods)
      message(FATAL_ERROR
        "Building OpenSSL needs Git for Windows' sh (found: '${QUAERO_GIT_SH}') and "
        "a Perl module tree with Pod::Usage, ExtUtils::MakeMaker and "
        "Locale::Maketext::Simple (MSYS2's or Strawberry Perl's; or set "
        "QUAERO_PERL_MODULES).")
    endif()
    message(STATUS "OpenSSL: borrowing Perl modules from ${_perl_mods}")

    set(_tarball "${_root}/openssl-${QUAERO_OPENSSL_VERSION}.tar.gz")
    message(STATUS "OpenSSL ${QUAERO_OPENSSL_VERSION}: downloading")
    file(DOWNLOAD
      "https://github.com/openssl/openssl/releases/download/openssl-${QUAERO_OPENSSL_VERSION}/openssl-${QUAERO_OPENSSL_VERSION}.tar.gz"
      "${_tarball}" EXPECTED_HASH SHA256=${QUAERO_OPENSSL_SHA256})
    # Always a fresh tree: a failed run leaves half-written generated headers.
    file(REMOVE_RECURSE "${_root}/src" "${_prefix}")
    file(ARCHIVE_EXTRACT INPUT "${_tarball}" DESTINATION "${_root}/src")

    get_filename_component(_mingw_bin "${CMAKE_C_COMPILER}" DIRECTORY)
    cmake_host_system_information(RESULT _jobs QUERY NUMBER_OF_LOGICAL_CORES)
    set(_log "${_root}/build.log")
    message(STATUS "OpenSSL ${QUAERO_OPENSSL_VERSION}: building (several minutes; log: ${_log})")
    execute_process(
      COMMAND "${QUAERO_GIT_SH}" "${_quaero_openssl_module_dir}/openssl-build.sh"
              "${_root}/src/openssl-${QUAERO_OPENSSL_VERSION}" "${_prefix}"
              "${_mingw_bin}" "${_jobs}" "${_perl_mods}"
      RESULT_VARIABLE _rc
      OUTPUT_FILE "${_log}"
      ERROR_FILE "${_log}")
    if(NOT _rc EQUAL 0 OR NOT EXISTS "${_prefix}/lib/libssl.a")
      message(FATAL_ERROR "OpenSSL build failed (${_rc}); see ${_log}")
    endif()
    file(TOUCH "${_stamp}")
  endif()

  if(NOT TARGET quaero_openssl_crypto)
    # What OpenSSL's Windows code references: sockets, the crypto API for the
    # system random source, and the user/GDI calls of its entropy gathering.
    add_library(quaero_openssl_crypto STATIC IMPORTED GLOBAL)
    set_target_properties(quaero_openssl_crypto PROPERTIES
      IMPORTED_LOCATION "${_prefix}/lib/libcrypto.a"
      INTERFACE_INCLUDE_DIRECTORIES "${_prefix}/include"
      INTERFACE_LINK_LIBRARIES "ws2_32;crypt32;gdi32;user32;advapi32")
    add_library(quaero_openssl_ssl STATIC IMPORTED GLOBAL)
    set_target_properties(quaero_openssl_ssl PROPERTIES
      IMPORTED_LOCATION "${_prefix}/lib/libssl.a"
      INTERFACE_INCLUDE_DIRECTORIES "${_prefix}/include"
      INTERFACE_LINK_LIBRARIES quaero_openssl_crypto)
  endif()

  set(OPENSSL_FOUND TRUE PARENT_SCOPE)
  set(OPENSSL_INCLUDE_DIR "${_prefix}/include" PARENT_SCOPE)
  # Targets, not file paths: the connector links whatever these name, and only a
  # target carries OpenSSL's own system libraries (ws2_32, crypt32, …) along
  # behind it. With bare paths they landed before libcrypto.a on the link line
  # and its socket calls went unresolved.
  set(OPENSSL_SSL_LIBRARY quaero_openssl_ssl PARENT_SCOPE)
  set(OPENSSL_CRYPTO_LIBRARY quaero_openssl_crypto PARENT_SCOPE)
  set(OPENSSL_VERSION "${QUAERO_OPENSSL_VERSION}" PARENT_SCOPE)
endfunction()
