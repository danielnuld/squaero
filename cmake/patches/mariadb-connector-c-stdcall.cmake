# FetchContent PATCH_COMMAND for MariaDB Connector/C (see cmake/QuaeroMariaDB.cmake).
#
# On 32-bit Windows __stdcall != __cdecl. The connector declares mysql_load_plugin()
# WITHOUT STDCALL (include/mysql/client_plugin.h, include/mysql.h) but defines it
# WITH STDCALL (libmariadb/ma_client_plugin.c.in), so GCC rejects it as
# "conflicting types for 'mysql_load_plugin'" on i686 (the mismatch is invisible
# on x86_64, where the calling conventions collapse). Add STDCALL to both public
# declarations so they match the definition.
#
# Idempotent: the regex only matches the un-annotated form, so a re-run is a
# no-op. CRLF-tolerant (\r?\n). Invoked with -DMARIADB_SRC=<SOURCE_DIR>.

foreach(_hdr "include/mysql/client_plugin.h" "include/mysql.h")
  set(_path "${MARIADB_SRC}/${_hdr}")
  file(READ "${_path}" _contents)
  string(REGEX REPLACE
    "st_mysql_client_plugin \\*(\r?\n)mysql_load_plugin\\(struct st_mysql"
    "st_mysql_client_plugin * STDCALL\\1mysql_load_plugin(struct st_mysql"
    _contents "${_contents}")
  file(WRITE "${_path}" "${_contents}")
endforeach()
