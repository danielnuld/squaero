#include "identifier.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for PostgreSQL identifier quoting: double quotes, doubling of an
   embedded double quote, bounds, NULL. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    char buf[64];

    EXPECT(pg_quote_identifier("users", buf, sizeof buf) == 1, "simple ok");
    EXPECT(strcmp(buf, "\"users\"") == 0, "simple quoted");

    EXPECT(pg_quote_identifier("", buf, sizeof buf) == 1, "empty ok");
    EXPECT(strcmp(buf, "\"\"") == 0, "empty -> two quotes");

    /* A mixed-case identifier keeps its case (that is the point of quoting). */
    EXPECT(pg_quote_identifier("MyTable", buf, sizeof buf) == 1, "mixed case ok");
    EXPECT(strcmp(buf, "\"MyTable\"") == 0, "mixed case preserved");

    /* An embedded double quote is doubled. */
    EXPECT(pg_quote_identifier("a\"b", buf, sizeof buf) == 1, "embedded ok");
    EXPECT(strcmp(buf, "\"a\"\"b\"") == 0, "embedded quote doubled");

    /* Injection attempt stays inside the quotes. */
    EXPECT(pg_quote_identifier("x\"; DROP--", buf, sizeof buf) == 1, "injection ok");
    EXPECT(strcmp(buf, "\"x\"\"; DROP--\"") == 0, "injection neutralized");

    EXPECT(pg_quote_identifier(NULL, buf, sizeof buf) == 0, "NULL id fails");
    EXPECT(pg_quote_identifier("x", NULL, sizeof buf) == 0, "NULL buf fails");

    /* "ab" needs 5 bytes (quote a b quote NUL); 4 must reject, 5 fit. */
    EXPECT(pg_quote_identifier("ab", buf, 4) == 0, "too small fails");
    EXPECT(pg_quote_identifier("ab", buf, 5) == 1, "exact fit ok");
    EXPECT(strcmp(buf, "\"ab\"") == 0, "exact fit content");

    if (failures == 0) {
        printf("OK: postgres identifier quoting (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
