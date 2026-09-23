/*
 * UTF-8 -> UTF-16 for statement text (issue #324).
 *
 * The statement is what the server parses, so a wrong conversion does not just
 * garble a display value — it runs a different query than the user wrote. These
 * tests pin the exact code units, not just "it produced something".
 */
#include "utf16.h"

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

/* Convert `in` and assert it equals the `want` array of `want_len` code units. */
static void expect_units(const char *in, const unsigned short *want,
                         size_t want_len, const char *msg)
{
    size_t len = 999;
    unsigned short *got = ifx_utf8_to_utf16(in, &len);
    EXPECT(got != NULL, msg);
    if (got == NULL) {
        return;
    }
    /* %zu is not portable across this project's toolchains (MinGW's msvcrt
       printf), so widths are cast explicitly. */
    if (len != want_len) {
        fprintf(stderr, "FAIL: %s (len %lu, want %lu)\n", msg,
                (unsigned long)len, (unsigned long)want_len);
        failures++;
    } else {
        for (size_t i = 0; i < want_len; i++) {
            if (got[i] != want[i]) {
                fprintf(stderr, "FAIL: %s (unit %lu = 0x%04X, want 0x%04X)\n",
                        msg, (unsigned long)i, (unsigned)got[i], (unsigned)want[i]);
                failures++;
                break;
            }
        }
    }
    EXPECT(got[len] == 0, "result is NUL-terminated");
    free(got);
}

static void test_wide_gate(void)
{
    /* Nothing to gain: ASCII keeps the call it always used. */
    EXPECT(ifx_sql_wide_safe(NULL) == 0, "NULL stays ansi");
    EXPECT(ifx_sql_wide_safe("") == 0, "empty stays ansi");
    EXPECT(ifx_sql_wide_safe("SELECT * FROM t WHERE id = 1") == 0,
           "plain statement stays ansi");
    EXPECT(ifx_sql_wide_safe("SELECT a\tb\nc") == 0, "tabs and newlines stay ansi");
    EXPECT(ifx_sql_wide_safe("SELECT 'plain'") == 0, "ascii literal stays ansi");

    /* The case this exists for: accents inside a literal. */
    EXPECT(ifx_sql_wide_safe("SELECT '\xC3\xB1'") == 1, "accented literal goes wide");
    EXPECT(ifx_sql_wide_safe("SELECT id FROM t WHERE n LIKE '%\xC3\xB1" "ada%'") == 1,
           "accented LIKE pattern goes wide");
    EXPECT(ifx_sql_wide_safe("INSERT INTO t VALUES ('Obreg\xC3\xB3n', 1)") == 1,
           "accented insert value goes wide");
    /* Several literals, accent in a later one. */
    EXPECT(ifx_sql_wide_safe("SELECT 'a', 'b', 'caf\xC3\xA9'") == 1,
           "accent in a later literal goes wide");

    /* The case that would crash the driver: non-ASCII outside a literal. */
    EXPECT(ifx_sql_wide_safe("SELECT id AS a\xC3\xB1o FROM t") == 0,
           "accented alias stays ansi");
    EXPECT(ifx_sql_wide_safe("SELECT * FROM a\xC3\xB1os") == 0,
           "accented table name stays ansi");
    EXPECT(ifx_sql_wide_safe("SELECT \"a\xC3\xB1o\" FROM t") == 0,
           "accented delimited identifier stays ansi");
    EXPECT(ifx_sql_wide_safe("SELECT 1 -- a\xC3\xB1o") == 0,
           "accent in a comment stays ansi");
    /* One accent inside a literal does not license another outside it. */
    EXPECT(ifx_sql_wide_safe("SELECT '\xC3\xB1' AS a\xC3\xB1o") == 0,
           "mixed inside and outside stays ansi");

    /* Quote bookkeeping: a doubled quote is an escape, not the end of the literal,
       so an accent after it is still inside. */
    EXPECT(ifx_sql_wide_safe("SELECT 'it''s caf\xC3\xA9'") == 1,
           "escaped quote keeps the literal open");
    /* And the mirror: after a genuinely closed literal we are outside again. */
    EXPECT(ifx_sql_wide_safe("SELECT 'a' , b\xC3\xB1") == 0,
           "after a closed literal we are outside");
    /* An unterminated literal: the accent is still inside it. */
    EXPECT(ifx_sql_wide_safe("SELECT 'caf\xC3\xA9") == 1,
           "unterminated literal counts as inside");
}

static void test_ascii_conversion(void)
{
    static const unsigned short want[] = { 'S', 'E', 'L', 'E', 'C', 'T', ' ', '1' };
    expect_units("SELECT 1", want, 8, "ascii widens one unit per byte");

    size_t len = 999;
    unsigned short *empty = ifx_utf8_to_utf16("", &len);
    EXPECT(empty != NULL && len == 0 && empty[0] == 0, "empty converts to empty");
    free(empty);
}

static void test_accents(void)
{
    /* "ñ" U+00F1, the character that started this. */
    static const unsigned short enye[] = { 0x00F1 };
    expect_units("\xC3\xB1", enye, 1, "two-byte sequence -> one unit");

    /* A whole statement, the shape that silently matched nothing before. */
    static const unsigned short like[] = {
        'L', 'I', 'K', 'E', ' ', '\'', '%', 0x00F1, 'a', 'd', 'a', '%', '\'',
    };
    expect_units("LIKE '%\xC3\xB1" "ada%'", like, 13, "accented LIKE pattern");

    /* Three-byte sequence: the euro sign U+20AC. */
    static const unsigned short euro[] = { 0x20AC };
    expect_units("\xE2\x82\xAC", euro, 1, "three-byte sequence -> one unit");

    /* Boundaries of the BMP ranges. */
    static const unsigned short lo[] = { 0x0080 };
    expect_units("\xC2\x80", lo, 1, "U+0080");
    static const unsigned short hi[] = { 0xFFFF };
    expect_units("\xEF\xBF\xBF", hi, 1, "U+FFFF");
    /* Either side of the surrogate hole stays a single unit. */
    static const unsigned short d7ff[] = { 0xD7FF };
    expect_units("\xED\x9F\xBF", d7ff, 1, "U+D7FF");
    static const unsigned short e000[] = { 0xE000 };
    expect_units("\xEE\x80\x80", e000, 1, "U+E000");
}

static void test_surrogate_pairs(void)
{
    /* U+1D11E (musical G clef) must become a correct surrogate pair, not one
       truncated unit — otherwise the statement sent is not the one written. */
    static const unsigned short clef[] = { 0xD834, 0xDD1E };
    expect_units("\xF0\x9D\x84\x9E", clef, 2, "astral char -> surrogate pair");

    /* The extremes of the astral range. */
    static const unsigned short first[] = { 0xD800, 0xDC00 };
    expect_units("\xF0\x90\x80\x80", first, 2, "U+10000 -> first pair");
    static const unsigned short last[] = { 0xDBFF, 0xDFFF };
    expect_units("\xF4\x8F\xBF\xBF", last, 2, "U+10FFFF -> last pair");

    /* Mixed with ASCII, to catch an output-index bug that only shows when a pair
       is followed by more text. */
    static const unsigned short mixed[] = { 'a', 0xD834, 0xDD1E, 'b' };
    expect_units("a\xF0\x9D\x84\x9E" "b", mixed, 4, "pair surrounded by ascii");
}

static void test_malformed_is_refused(void)
{
    /* Refusing is the point: the caller falls back to the ANSI path instead of
       sending a statement we silently altered. */
    EXPECT(ifx_utf8_to_utf16(NULL, NULL) == NULL, "NULL refused");
    EXPECT(ifx_utf8_to_utf16("\x80", NULL) == NULL, "lone continuation refused");
    EXPECT(ifx_utf8_to_utf16("\xC3", NULL) == NULL, "truncated 2-byte refused");
    EXPECT(ifx_utf8_to_utf16("\xE2\x82", NULL) == NULL, "truncated 3-byte refused");
    EXPECT(ifx_utf8_to_utf16("\xF0\x9D\x84", NULL) == NULL, "truncated 4-byte refused");
    EXPECT(ifx_utf8_to_utf16("ok\xC3", NULL) == NULL, "truncated tail refused");
    EXPECT(ifx_utf8_to_utf16("\xC3z", NULL) == NULL, "lead + ascii refused");
    /* Overlong forms and surrogates: a decoder that accepted these could turn one
       statement into another. */
    EXPECT(ifx_utf8_to_utf16("\xC0\x80", NULL) == NULL, "overlong NUL refused");
    EXPECT(ifx_utf8_to_utf16("\xE0\x80\xAF", NULL) == NULL, "overlong 3-byte refused");
    EXPECT(ifx_utf8_to_utf16("\xF0\x80\x80\x80", NULL) == NULL, "overlong 4-byte refused");
    EXPECT(ifx_utf8_to_utf16("\xED\xA0\x80", NULL) == NULL, "encoded surrogate refused");
    EXPECT(ifx_utf8_to_utf16("\xF4\x90\x80\x80", NULL) == NULL, "above U+10FFFF refused");
    EXPECT(ifx_utf8_to_utf16("\xFF", NULL) == NULL, "0xFF refused");
    /* Latin-1 text (not UTF-8) is refused too, which is why the fallback exists. */
    EXPECT(ifx_utf8_to_utf16("Nog\xE1les", NULL) == NULL, "latin-1 input refused");
}

int main(void)
{
    test_wide_gate();
    test_ascii_conversion();
    test_accents();
    test_surrogate_pairs();
    test_malformed_is_refused();

    if (failures == 0) {
        printf("OK: informix utf8->utf16 statement conversion (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
