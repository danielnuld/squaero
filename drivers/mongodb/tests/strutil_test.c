#include "json_check.h"
#include "strutil.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the shared string helpers and the strict JSON validator. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static void expect_js(const char *in, const char *want)
{
    mongo_sb b = {0};
    mongo_sb_js_string(&b, in);
    char *got = mongo_sb_take(&b);
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: js_string(%s) -> %s (want %s)\n", in ? in : "(null)",
                got ? got : "(null)", want);
        failures++;
    }
    free(got);
}

static void expect_ref(const char *name, const char *want)
{
    mongo_sb b = {0};
    mongo_sb_coll_ref(&b, name);
    char *got = mongo_sb_take(&b);
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: coll_ref(%s) -> %s (want %s)\n", name, got ? got : "(null)", want);
        failures++;
    }
    free(got);
}

int main(void)
{
    /* growable buffer */
    {
        mongo_sb b = {0};
        for (int i = 0; i < 1000; i++) {
            mongo_sb_puts(&b, "abc");
        }
        mongo_sb_putc(&b, '!');
        char *s = mongo_sb_take(&b);
        EXPECT(s != NULL && strlen(s) == 3001 && s[3000] == '!', "buffer grows and terminates");
        free(s);
        char *e = mongo_sb_take(&b);
        EXPECT(e != NULL && e[0] == '\0', "an empty buffer yields an empty string");
        free(e);
    }

    /* JS string literals */
    expect_js("plain", "\"plain\"");
    expect_js("", "\"\"");
    expect_js(NULL, "\"\"");
    expect_js("a\"b\\c", "\"a\\\"b\\\\c\"");
    expect_js("line\nbreak\ttab\r", "\"line\\nbreak\\ttab\\r\"");
    expect_js("\x01\x1f", "\"\\u0001\\u001f\"");
    expect_js("ni\xc3\xb1o \xe2\x82\xac", "\"ni\xc3\xb1o \xe2\x82\xac\"");

    /* collection references */
    EXPECT(mongo_name_is_simple("users"), "simple name");
    EXPECT(mongo_name_is_simple("system.profile"), "dotted simple name");
    EXPECT(mongo_name_is_simple("_a1.b2"), "underscore and digits");
    EXPECT(!mongo_name_is_simple(""), "empty is not simple");
    EXPECT(!mongo_name_is_simple("1abc"), "leading digit");
    EXPECT(!mongo_name_is_simple("a-b"), "dash");
    EXPECT(!mongo_name_is_simple("a b"), "space");
    EXPECT(!mongo_name_is_simple(".a"), "leading dot");
    EXPECT(!mongo_name_is_simple("a..b"), "empty segment");
    EXPECT(!mongo_name_is_simple("a."), "trailing dot");
    EXPECT(!mongo_name_is_simple(NULL), "NULL");
    expect_ref("users", "db.users");
    expect_ref("my-coll", "db.getCollection(\"my-coll\")");
    expect_ref("we\"ird", "db.getCollection(\"we\\\"ird\")");

    /* strict JSON validation */
    const char *good[] = {"{}", "[]", "0", "-1.5e+3", "\"x\"", "true", "false", "null",
                          "  {\"a\": [1, 2, {\"b\": null}], \"c\": \"\\u00e9\\n\"}  ",
                          "[[[[]]]]", "{\"$oid\":\"5f1d7f3e9b1e8a0012345678\"}"};
    for (size_t i = 0; i < sizeof good / sizeof good[0]; i++) {
        if (!mongo_json_valid(good[i])) {
            fprintf(stderr, "FAIL: should be valid JSON: %s\n", good[i]);
            failures++;
        }
    }
    const char *bad[] = {"", " ", "{", "{\"a\"}", "{\"a\": }", "{a: 1}", "{'a': 1}", "[1,]", "[1 2]",
                         "01", "1.", ".5", "+1", "\"unterminated", "\"bad\\x\"", "\"\\u12\"",
                         "{} {}", "{}, {}", "tru", "nulll", "\"tab\there\"", "NaN"};
    for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
        if (mongo_json_valid(bad[i])) {
            fprintf(stderr, "FAIL: should be invalid JSON: %s\n", bad[i]);
            failures++;
        }
    }
    EXPECT(!mongo_json_valid(NULL), "NULL is not JSON");
    {
        char ok[2 * 64 + 1];
        memset(ok, '[', 60);
        memset(ok + 60, ']', 60);
        ok[120] = '\0';
        EXPECT(mongo_json_valid(ok), "reasonable nesting is accepted");
        char toodeep[2 * 70 + 1];
        memset(toodeep, '[', 70);
        memset(toodeep + 70, ']', 70);
        toodeep[140] = '\0';
        EXPECT(!mongo_json_valid(toodeep), "nesting over the limit is refused");
    }

    /* numbers */
    int is_int = -1;
    EXPECT(mongo_json_is_number("42", &is_int) && is_int == 1, "integer");
    EXPECT(mongo_json_is_number("-0", &is_int) && is_int == 1, "negative zero is an integer");
    EXPECT(mongo_json_is_number("4.2", &is_int) && is_int == 0, "fraction");
    EXPECT(mongo_json_is_number("1e3", &is_int) && is_int == 0, "exponent");
    EXPECT(!mongo_json_is_number("007", NULL), "leading zeros");
    EXPECT(!mongo_json_is_number("1 ", NULL), "trailing space");
    EXPECT(!mongo_json_is_number("", NULL), "empty");
    EXPECT(!mongo_json_is_number("abc", NULL), "text");
    EXPECT(!mongo_json_is_number(NULL, NULL), "NULL");

    if (failures == 0) {
        printf("OK: mongodb string helpers + json validator (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
