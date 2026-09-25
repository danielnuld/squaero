/* The slice of the MySQL client API the driver uses, implemented on libmywire
 * (issue #583). Built instead of MariaDB Connector/C where an LGPL client
 * cannot ship (iOS, QUAERO_MYWIRE): the driver's sources include this <mysql.h>
 * unchanged. Results are stored whole, as mysql_store_result does, because
 * the protocol allows only one open result per connection and the driver runs
 * metadata queries while a result is open. */
#ifndef QUAERO_MYWIRE_MYSQL_H
#define QUAERO_MYWIRE_MYSQL_H

typedef struct MYSQL MYSQL;
typedef struct MYSQL_RES MYSQL_RES;
typedef char **MYSQL_ROW;

typedef struct {
    char *name;
    unsigned int type;
    unsigned int flags;
    unsigned int charsetnr;
    unsigned long length;
    unsigned int decimals;
} MYSQL_FIELD;

/* mysql_options: the ones the driver sets. SSL_MODE is what carries its TLS
 * choice; MYSQL_OPT_SSL_ENFORCE and _VERIFY_SERVER_CERT are left undefined so
 * the driver skips those MariaDB-only knobs. */
#define MYSQL_SET_CHARSET_NAME 7
#define MYSQL_PLUGIN_DIR 22
#define MYSQL_OPT_SSL_MODE 42
enum {
    SSL_MODE_DISABLED = 1,
    SSL_MODE_PREFERRED,
    SSL_MODE_REQUIRED,
    SSL_MODE_VERIFY_CA,
    SSL_MODE_VERIFY_IDENTITY
};

MYSQL *mysql_init(MYSQL *unused);
int mysql_options(MYSQL *db, int option, const void *arg);
int mysql_ssl_set(MYSQL *db, const char *key, const char *cert, const char *ca,
                  const char *capath, const char *cipher);
MYSQL *mysql_real_connect(MYSQL *db, const char *host, const char *user, const char *password,
                          const char *database, unsigned int port, const char *unix_socket,
                          unsigned long flags);
void mysql_close(MYSQL *db);
const char *mysql_error(MYSQL *db);
unsigned int mysql_errno(MYSQL *db);
const char *mysql_get_ssl_cipher(MYSQL *db);
unsigned long mysql_thread_id(MYSQL *db);
int mysql_thread_init(void);
void mysql_thread_end(void);

int mysql_real_query(MYSQL *db, const char *sql, unsigned long len);
int mysql_query(MYSQL *db, const char *sql);
MYSQL_RES *mysql_store_result(MYSQL *db);
unsigned int mysql_field_count(MYSQL *db);
unsigned long long mysql_affected_rows(MYSQL *db);
unsigned int mysql_num_fields(MYSQL_RES *res);
MYSQL_FIELD *mysql_fetch_fields(MYSQL_RES *res);
MYSQL_ROW mysql_fetch_row(MYSQL_RES *res);
unsigned long *mysql_fetch_lengths(MYSQL_RES *res);
void mysql_free_result(MYSQL_RES *res);
unsigned long mysql_real_escape_string(MYSQL *db, char *to, const char *from, unsigned long len);

#endif
