#include "identifier.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for T-SQL quoting: bracketed identifiers and N'' literals. */

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

    EXPECT(mssql_quote_identifier("users", buf, sizeof buf) == 1, "simple ok");
    EXPECT(strcmp(buf, "[users]") == 0, "simple bracketed");

    EXPECT(mssql_quote_identifier("", buf, sizeof buf) == 1, "empty ok");
    EXPECT(strcmp(buf, "[]") == 0, "empty -> two brackets");

    /* A closing bracket is doubled; an opening one needs nothing. */
    EXPECT(mssql_quote_identifier("a]b", buf, sizeof buf) == 1, "embedded ] ok");
    EXPECT(strcmp(buf, "[a]]b]") == 0, "embedded ] doubled");
    EXPECT(mssql_quote_identifier("a[b", buf, sizeof buf) == 1, "embedded [ ok");
    EXPECT(strcmp(buf, "[a[b]") == 0, "embedded [ kept");

    /* Injection attempt stays inside the brackets. */
    EXPECT(mssql_quote_identifier("x]; DROP TABLE t--", buf, sizeof buf) == 1, "injection ok");
    EXPECT(strcmp(buf, "[x]]; DROP TABLE t--]") == 0, "injection neutralized");

    EXPECT(mssql_quote_identifier(NULL, buf, sizeof buf) == 0, "NULL id fails");
    EXPECT(mssql_quote_identifier("x", NULL, sizeof buf) == 0, "NULL buf fails");

    /* "ab" needs 5 bytes ([ a b ] NUL); 4 must reject, 5 fit. */
    EXPECT(mssql_quote_identifier("ab", buf, 4) == 0, "too small fails");
    EXPECT(mssql_quote_identifier("ab", buf, 5) == 1, "exact fit ok");
    EXPECT(strcmp(buf, "[ab]") == 0, "exact fit content");

    /* Literals: N prefix, single quote doubled, non-ASCII bytes untouched. */
    EXPECT(mssql_quote_literal("dbo", buf, sizeof buf) == 1, "literal ok");
    EXPECT(strcmp(buf, "N'dbo'") == 0, "literal N-prefixed");
    EXPECT(mssql_quote_literal("it's", buf, sizeof buf) == 1, "literal quote ok");
    EXPECT(strcmp(buf, "N'it''s'") == 0, "literal quote doubled");
    EXPECT(mssql_quote_literal("Obregón", buf, sizeof buf) == 1, "literal utf-8 ok");
    EXPECT(strcmp(buf, "N'Obregón'") == 0, "literal utf-8 kept");
    EXPECT(mssql_quote_literal("x", buf, 4) == 0, "literal too small fails");
    EXPECT(mssql_quote_literal("x", buf, 5) == 1, "literal exact fit ok");
    EXPECT(mssql_quote_literal(NULL, buf, sizeof buf) == 0, "literal NULL fails");

    if (failures == 0) {
        printf("OK: mssql identifier + literal quoting (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
