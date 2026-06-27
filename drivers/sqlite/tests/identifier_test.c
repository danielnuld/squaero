#include "identifier.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for SQL identifier quoting: doubling embedded quotes, buffer
   bounds, and NULL handling. */

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

    EXPECT(sqlite_quote_identifier("main", buf, sizeof buf) == 1, "simple ok");
    EXPECT(strcmp(buf, "\"main\"") == 0, "simple quoted");

    EXPECT(sqlite_quote_identifier("", buf, sizeof buf) == 1, "empty ok");
    EXPECT(strcmp(buf, "\"\"") == 0, "empty -> two quotes");

    /* A double quote inside the identifier is doubled. */
    EXPECT(sqlite_quote_identifier("a\"b", buf, sizeof buf) == 1, "embedded quote ok");
    EXPECT(strcmp(buf, "\"a\"\"b\"") == 0, "embedded quote doubled");

    /* Injection attempt stays inside the quotes (doubled, not closing). */
    EXPECT(sqlite_quote_identifier("x\" UNION--", buf, sizeof buf) == 1, "injection ok");
    EXPECT(strcmp(buf, "\"x\"\" UNION--\"") == 0, "injection neutralized");

    /* NULL args fail. */
    EXPECT(sqlite_quote_identifier(NULL, buf, sizeof buf) == 0, "NULL id fails");
    EXPECT(sqlite_quote_identifier("x", NULL, sizeof buf) == 0, "NULL buf fails");

    /* Too-small buffer fails rather than truncating. "ab" needs 5 bytes
       (quote a b quote NUL); a 4-byte buffer must reject. */
    EXPECT(sqlite_quote_identifier("ab", buf, 4) == 0, "too small fails");
    /* Exactly enough succeeds. */
    EXPECT(sqlite_quote_identifier("ab", buf, 5) == 1, "exact fit ok");
    EXPECT(strcmp(buf, "\"ab\"") == 0, "exact fit content");

    if (failures == 0) {
        printf("OK: sqlite identifier quoting (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
