#include "ssh_config.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Parse and assert success; leaves the populated config in *cfg for the caller
   to inspect and dispose. */
static dbc_status parse(const char *dsn, ssh_config *cfg)
{
    char err[128] = "untouched";
    dbc_status st = ssh_config_parse(dsn, cfg, err, sizeof err);
    return st;
}

int main(void)
{
    /* --- absent: a plain DSN with no ssh_* fields is not tunnelled --- */
    {
        ssh_config c = {0};
        EXPECT(parse("{\"host\":\"db\",\"port\":3306}", &c) == DBC_OK,
               "plain dsn parses");
        EXPECT(c.present == 0, "no ssh_host => not present");
        ssh_config_dispose(&c);
    }

    /* --- nominal: full key-auth config, target defaulted from DSN --- */
    {
        ssh_config c = {0};
        const char *dsn =
            "{\"host\":\"10.0.0.5\",\"port\":3306,"
            "\"ssh_host\":\"bastion.example.com\",\"ssh_port\":2222,"
            "\"ssh_user\":\"deploy\",\"ssh_auth\":\"key\","
            "\"ssh_key\":\"/home/me/.ssh/id_ed25519\","
            "\"ssh_key_passphrase\":\"hunter2\"}";
        EXPECT(parse(dsn, &c) == DBC_OK, "full key config parses");
        EXPECT(c.present == 1, "present");
        EXPECT(strcmp(c.host, "bastion.example.com") == 0, "ssh host");
        EXPECT(c.port == 2222, "ssh port");
        EXPECT(strcmp(c.user, "deploy") == 0, "ssh user");
        EXPECT(c.auth == SSH_AUTH_KEY, "auth=key");
        EXPECT(c.key_path && strcmp(c.key_path, "/home/me/.ssh/id_ed25519") == 0,
               "key path");
        EXPECT(c.key_passphrase && strcmp(c.key_passphrase, "hunter2") == 0,
               "key passphrase");
        /* target defaults to the DSN host/port reached from the bastion */
        EXPECT(c.target_host && strcmp(c.target_host, "10.0.0.5") == 0,
               "target host defaults to dsn host");
        EXPECT(c.target_port == 3306, "target port defaults to dsn port");
        ssh_config_dispose(&c);
    }

    /* --- defaults: ssh_port=22, auth=agent, target host falls back to loopback
           when the DSN names no host --- */
    {
        ssh_config c = {0};
        EXPECT(parse("{\"ssh_host\":\"h\",\"ssh_user\":\"u\"}", &c) == DBC_OK,
               "minimal agent config parses");
        EXPECT(c.port == 22, "ssh port defaults to 22");
        EXPECT(c.auth == SSH_AUTH_AGENT, "auth defaults to agent");
        EXPECT(c.target_host && strcmp(c.target_host, "127.0.0.1") == 0,
               "target host falls back to loopback");
        EXPECT(c.target_port == 0, "target port 0 => engine default");
        ssh_config_dispose(&c);
    }

    /* --- explicit target overrides the DSN host/port --- */
    {
        ssh_config c = {0};
        const char *dsn =
            "{\"host\":\"ignored\",\"port\":1,\"ssh_host\":\"h\","
            "\"ssh_user\":\"u\",\"ssh_target_host\":\"db.internal\","
            "\"ssh_target_port\":5432}";
        EXPECT(parse(dsn, &c) == DBC_OK, "explicit target parses");
        EXPECT(strcmp(c.target_host, "db.internal") == 0, "explicit target host");
        EXPECT(c.target_port == 5432, "explicit target port");
        ssh_config_dispose(&c);
    }

    /* --- numeric fields may arrive as strings (frontend sends DSN as strings) --- */
    {
        ssh_config c = {0};
        const char *dsn =
            "{\"host\":\"db\",\"port\":\"3307\",\"ssh_host\":\"h\","
            "\"ssh_user\":\"u\",\"ssh_port\":\"2222\"}";
        EXPECT(parse(dsn, &c) == DBC_OK, "string ports parse");
        EXPECT(c.port == 2222, "ssh_port from string");
        EXPECT(c.target_port == 3307, "target port from string dsn port");
        ssh_config_dispose(&c);
    }

    /* --- a non-numeric port string is ignored (falls back to default) --- */
    {
        ssh_config c = {0};
        const char *dsn = "{\"ssh_host\":\"h\",\"ssh_user\":\"u\",\"ssh_port\":\"abc\"}";
        EXPECT(parse(dsn, &c) == DBC_OK, "garbage port parses");
        EXPECT(c.port == 22, "non-numeric ssh_port falls back to 22");
        ssh_config_dispose(&c);
    }

    /* --- password auth --- */
    {
        ssh_config c = {0};
        const char *dsn = "{\"ssh_host\":\"h\",\"ssh_user\":\"u\","
                          "\"ssh_auth\":\"password\",\"ssh_password\":\"pw\"}";
        EXPECT(parse(dsn, &c) == DBC_OK, "password config parses");
        EXPECT(c.auth == SSH_AUTH_PASSWORD, "auth=password");
        EXPECT(c.password && strcmp(c.password, "pw") == 0, "password copied");
        ssh_config_dispose(&c);
    }

    /* --- invalid: not a JSON object --- */
    {
        ssh_config c = {0};
        char err[128] = "";
        EXPECT(ssh_config_parse("not json", &c, err, sizeof err) == DBC_ERR_PARAM,
               "garbage dsn is PARAM");
        EXPECT(err[0] != '\0', "error message set");
        ssh_config_dispose(&c);
    }

    /* --- invalid: ssh present but no user --- */
    {
        ssh_config c = {0};
        char err[128] = "";
        EXPECT(ssh_config_parse("{\"ssh_host\":\"h\"}", &c, err, sizeof err)
                   == DBC_ERR_PARAM,
               "missing ssh_user is PARAM");
        EXPECT(strstr(err, "ssh_user") != NULL, "error names ssh_user");
        EXPECT(c.present == 0, "failed parse leaves config disposed");
        ssh_config_dispose(&c);
    }

    /* --- invalid: unknown auth method --- */
    {
        ssh_config c = {0};
        char err[128] = "";
        EXPECT(ssh_config_parse(
                   "{\"ssh_host\":\"h\",\"ssh_user\":\"u\",\"ssh_auth\":\"totp\"}",
                   &c, err, sizeof err) == DBC_ERR_PARAM,
               "unknown ssh_auth is PARAM");
        EXPECT(strstr(err, "ssh_auth") != NULL, "error names ssh_auth");
        ssh_config_dispose(&c);
    }

    /* --- invalid: password auth without a password --- */
    {
        ssh_config c = {0};
        char err[128] = "";
        EXPECT(ssh_config_parse(
                   "{\"ssh_host\":\"h\",\"ssh_user\":\"u\",\"ssh_auth\":\"password\"}",
                   &c, err, sizeof err) == DBC_ERR_PARAM,
               "password auth needs ssh_password");
        EXPECT(strstr(err, "ssh_password") != NULL, "error names ssh_password");
        ssh_config_dispose(&c);
    }

    /* --- invalid: key auth without a key path --- */
    {
        ssh_config c = {0};
        char err[128] = "";
        EXPECT(ssh_config_parse(
                   "{\"ssh_host\":\"h\",\"ssh_user\":\"u\",\"ssh_auth\":\"key\"}",
                   &c, err, sizeof err) == DBC_ERR_PARAM,
               "key auth needs ssh_key");
        EXPECT(strstr(err, "ssh_key") != NULL, "error names ssh_key");
        ssh_config_dispose(&c);
    }

    /* --- NULL out is rejected; dispose(NULL) is safe --- */
    {
        EXPECT(ssh_config_parse("{}", NULL, NULL, 0) == DBC_ERR_PARAM,
               "NULL out is PARAM");
        ssh_config_dispose(NULL);
    }

    if (failures == 0) {
        printf("OK: ssh_config (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
