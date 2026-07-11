/* pg_config_paths.h — hand-authored for the i686 MinGW libpq build.
   libpq only references SYSCONFDIR (for pg_service.conf lookup). The rest are
   provided empty to satisfy any incidental reference; a client that needs a
   service file can still point at it via PGSYSCONFDIR / PGSERVICEFILE. */
#define PGBINDIR ""
#define PGSHAREDIR ""
#define SYSCONFDIR ""
#define INCLUDEDIR ""
#define PKGINCLUDEDIR ""
#define INCLUDEDIRSERVER ""
#define LIBDIR ""
#define PKGLIBDIR ""
#define LOCALEDIR ""
#define DOCDIR ""
#define HTMLDIR ""
#define MANDIR ""
