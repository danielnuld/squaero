/*
 * The driver-side UTF-8 net (issues #315, #323).
 *
 * Two properties carry the weight. Text that is already valid must be handed back
 * untouched — this runs for every cell of every row, and rewriting valid text
 * would corrupt data. And text that is not valid must come out valid, because
 * invalid bytes in a response used to leave the grid loading forever.
 */
#include "text.h"

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

static void expect_str(const char *got, const char *want, const char *msg)
{
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: %s (got \"%s\", want \"%s\")\n", msg,
                got != NULL ? got : "(null)", want);
        failures++;
    }
}

static void test_validity(void)
{
    EXPECT(ifx_text_is_utf8(NULL) == 1, "NULL is valid");
    EXPECT(ifx_text_is_utf8("") == 1, "empty is valid");
    EXPECT(ifx_text_is_utf8("plain") == 1, "ascii is valid");
    EXPECT(ifx_text_is_utf8("caf\xC3\xA9") == 1, "utf-8 accent is valid");
    EXPECT(ifx_text_is_utf8("\xF0\x9D\x84\x9E") == 1, "4-byte sequence is valid");
    /* The shapes that broke the transport. */
    EXPECT(ifx_text_is_utf8("\xD1") == 0, "lone latin-1 N-tilde is invalid");
    EXPECT(ifx_text_is_utf8("Nog\xE1les") == 0, "latin-1 accent is invalid");
    EXPECT(ifx_text_is_utf8("\xC3") == 0, "truncated sequence is invalid");
    EXPECT(ifx_text_is_utf8("\x80") == 0, "lone continuation is invalid");
    /* Strictness: these are ill-formed and decoders disagree on them. */
    EXPECT(ifx_text_is_utf8("\xC0\x80") == 0, "overlong is invalid");
    EXPECT(ifx_text_is_utf8("\xED\xA0\x80") == 0, "surrogate is invalid");
    EXPECT(ifx_text_is_utf8("\xF4\x90\x80\x80") == 0, "above U+10FFFF is invalid");
}

static void test_valid_text_is_not_copied(void)
{
    /* The hot path: a valid value must come back as the very same pointer, with
       nothing allocated. */
    char *buf = NULL;
    size_t cap = 0;
    const char *in = "caf\xC3\xA9";
    const char *out = ifx_text_to_utf8(in, &buf, &cap);
    EXPECT(out == in, "valid text returns the original pointer");
    EXPECT(buf == NULL && cap == 0, "valid text allocates nothing");
    free(buf);
}

static void test_widening(void)
{
    char *buf = NULL;
    size_t cap = 0;

    /* Latin-1 'á' (0xE1) becomes U+00E1. */
    expect_str(ifx_text_to_utf8("Nog\xE1les", &buf, &cap), "Nog\xC3\xA1les",
               "latin-1 accent widens");
    EXPECT(buf != NULL && cap > 0, "widening allocated a buffer");

    /* The buffer is reused across calls, growing only when needed. */
    size_t first_cap = cap;
    expect_str(ifx_text_to_utf8("\xD1", &buf, &cap), "\xC3\x91",
               "second value reuses the buffer");
    EXPECT(cap == first_cap, "smaller value does not shrink or realloc");

    /* A longer value grows it. */
    expect_str(ifx_text_to_utf8("\xE1\xE9\xED\xF3\xFA \xF1 \xC1", &buf, &cap),
               "\xC3\xA1\xC3\xA9\xC3\xAD\xC3\xB3\xC3\xBA \xC3\xB1 \xC3\x81",
               "all five accents plus enye widen");
    EXPECT(ifx_text_is_utf8(buf), "widened output is valid utf-8");

    /* Extremes of the single-byte range. */
    expect_str(ifx_text_to_utf8("\x80", &buf, &cap), "\xC2\x80", "0x80 widens");
    expect_str(ifx_text_to_utf8("\xFF", &buf, &cap), "\xC3\xBF", "0xFF widens");
    free(buf);
}

static void test_dup(void)
{
    /* Always owned, whether or not conversion was needed. */
    char *a = ifx_text_to_utf8_dup("plain");
    expect_str(a, "plain", "dup of valid text");
    free(a);

    char *b = ifx_text_to_utf8_dup("a\xF1o");
    expect_str(b, "a\xC3\xB1o", "dup widens an accented column name");
    free(b);

    char *c = ifx_text_to_utf8_dup("");
    expect_str(c, "", "dup of empty");
    free(c);

    EXPECT(ifx_text_to_utf8_dup(NULL) == NULL, "dup of NULL is NULL");
}

static void test_fix_inplace(void)
{
    /* Valid text is left exactly alone. */
    char ok[64] = "no existe la tabla";
    ifx_text_fix_utf8_inplace(ok, sizeof ok);
    expect_str(ok, "no existe la tabla", "valid message untouched");

    /* A localized error message in Latin-1: the case that made the error vanish
       instead of reaching the user. */
    char msg[64] = "no existe la tabla \xF3rdenes";
    ifx_text_fix_utf8_inplace(msg, sizeof msg);
    expect_str(msg, "no existe la tabla \xC3\xB3rdenes", "latin-1 message fixed");
    EXPECT(ifx_text_is_utf8(msg), "fixed message is valid utf-8");

    /* Widening grows the text, so a full buffer must truncate rather than
       overflow — and must still be valid UTF-8 afterwards. */
    char tight[8] = "ab\xE1\xE9\xED";      /* 5 bytes in, 8 widen to */
    ifx_text_fix_utf8_inplace(tight, sizeof tight);
    EXPECT(strlen(tight) <= sizeof tight - 1, "truncated within the buffer");
    EXPECT(ifx_text_is_utf8(tight), "truncated message is still valid utf-8");
    EXPECT(strncmp(tight, "ab", 2) == 0, "truncation keeps the head");

    /* Truncating must never cut a two-byte sequence in half: that would leave
       precisely the invalid tail this function removes. */
    char cut[4] = "a\xE1";                 /* widens to "a" + 2 bytes = 3 + NUL */
    ifx_text_fix_utf8_inplace(cut, sizeof cut);
    EXPECT(ifx_text_is_utf8(cut), "no half sequence left behind");

    /* Degenerate buffers must not be touched out of bounds. */
    char one[1] = { '\0' };
    ifx_text_fix_utf8_inplace(one, sizeof one);
    EXPECT(one[0] == '\0', "single-byte buffer survives");
    ifx_text_fix_utf8_inplace(NULL, 10);
    ifx_text_fix_utf8_inplace(ok, 0);
}

int main(void)
{
    test_validity();
    test_valid_text_is_not_copied();
    test_widening();
    test_dup();
    test_fix_inplace();

    if (failures == 0) {
        printf("OK: informix utf-8 text net (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
