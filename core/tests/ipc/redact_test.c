/*
 * Secret-stripping for printed requests (issue #302).
 *
 * The property that matters: no output of this function ever contains the
 * password that went in — whatever shape the request had. Everything else (the
 * method, the ids, the host) must survive, or the trace stops being useful and
 * nobody turns it on.
 */
#include "dbcore/ipc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Redacts `in` and asserts the result holds `want` and never holds `forbidden`
   (pass NULL to skip either check). */
static void expect_redacted(const char *in, const char *forbidden, const char *want,
                            const char *msg)
{
    char *got = dbcore_ipc_redact(in);
    EXPECT(got != NULL, msg);
    if (got == NULL) {
        return;
    }
    if (forbidden != NULL && strstr(got, forbidden) != NULL) {
        fprintf(stderr, "FAIL: %s — leaked \"%s\" in: %s\n", msg, forbidden, got);
        failures++;
    }
    if (want != NULL && strstr(got, want) == NULL) {
        fprintf(stderr, "FAIL: %s — missing \"%s\" in: %s\n", msg, want, got);
        failures++;
    }
    dbcore_ipc_free(got);
}

int main(void)
{
    /* The reported case: conn.open carries the DSN, password and all. */
    expect_redacted(
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"conn.open\",\"params\":{\"driver\":\"mysql\","
        "\"dsn\":{\"host\":\"db.local\",\"user\":\"root\",\"password\":\"hunter2\"}}}",
        "hunter2", "\"password\":\"***\"", "conn.open password is masked");

    /* What is left has to still be worth printing. */
    expect_redacted(
        "{\"id\":2,\"method\":\"conn.open\",\"params\":{\"dsn\":{\"host\":\"db.local\","
        "\"password\":\"hunter2\"}}}",
        "hunter2", "\"host\":\"db.local\"", "the rest of the request survives");
    expect_redacted("{\"method\":\"query.run\",\"params\":{\"sql\":\"SELECT 1\"}}", NULL,
                    "\"sql\":\"SELECT 1\"", "a request with no secret is untouched");

    /* By name, not by path: a secret anywhere, under any spelling. */
    expect_redacted("{\"params\":{\"ssh\":{\"sshPassword\":\"s3cret\"}}}", "s3cret",
                    "\"sshPassword\":\"***\"", "nested sshPassword");
    expect_redacted("{\"params\":{\"tunnel_passphrase\":\"s3cret\"}}", "s3cret", "\"***\"",
                    "passphrase by substring");
    expect_redacted("{\"params\":{\"Token\":\"s3cret\"}}", "s3cret", "\"***\"",
                    "case-insensitive");
    expect_redacted("{\"params\":{\"apiKey\":\"s3cret\"}}", "s3cret", "\"***\"", "apiKey");

    /* A secret is masked whatever it holds: an object under such a key is not
       walked into, it is replaced whole. */
    expect_redacted("{\"params\":{\"credentials\":{\"user\":\"root\",\"pwd\":\"s3cret\"}}}",
                    "s3cret", "\"credentials\":\"***\"", "an object under a secret key");
    expect_redacted("{\"params\":{\"passwords\":[\"s3cret\",\"other\"]}}", "s3cret", "\"***\"",
                    "an array under a secret key");

    /* Inside arrays of objects (a batch), each element is walked. */
    expect_redacted("{\"params\":{\"conns\":[{\"host\":\"a\",\"password\":\"s3cret\"}]}}",
                    "s3cret", "\"host\":\"a\"", "objects inside an array");

    /* Never the raw input: a half-written conn.open still carries a password. */
    expect_redacted("{\"method\":\"conn.open\",\"params\":{\"dsn\":{\"password\":\"s3cret\"",
                    "s3cret", "withheld", "unparsable input is withheld");
    expect_redacted("not json at all", NULL, "withheld", "garbage is withheld");
    {
        char *got = dbcore_ipc_redact(NULL);
        EXPECT(got != NULL && strstr(got, "withheld") != NULL, "NULL is withheld");
        dbcore_ipc_free(got);
    }

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("redact_test: OK\n");
    return 0;
}
