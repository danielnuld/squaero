/*
 * The UTF-8 boundary guard (issue #323).
 *
 * Two properties matter more than the rest and are asserted first:
 *   1. Text that is already valid is handed on byte for byte. This runs for
 *      every cell of every result, so a guard that "helpfully" rewrote valid
 *      text would be a data-corruption bug across every engine.
 *   2. Text that is not valid still produces a decodable frame. That is the
 *      whole point: an invalid byte used to freeze the UI (#315).
 */
#include "utf8.h"

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

/* Repair `in`, assert the result equals `want`, free it. */
static void expect_repair(const char *in, const char *want, const char *msg)
{
    char *got = ipc_utf8_repair(in);
    EXPECT(got != NULL, msg);
    if (got != NULL) {
        if (strcmp(got, want) != 0) {
            fprintf(stderr, "FAIL: %s (got \"%s\")\n", msg, got);
            failures++;
        }
        free(got);
    }
}

#define REPL "\xEF\xBF\xBD"   /* U+FFFD */

static void test_valid_passes(void)
{
    EXPECT(ipc_utf8_valid(NULL) == 1, "NULL is valid");
    EXPECT(ipc_utf8_valid("") == 1, "empty is valid");
    EXPECT(ipc_utf8_valid("plain ascii") == 1, "ascii is valid");
    /* Two-, three- and four-byte sequences: "ñ", "€", "𝄞". */
    EXPECT(ipc_utf8_valid("\xC3\xB1") == 1, "2-byte sequence is valid");
    EXPECT(ipc_utf8_valid("\xE2\x82\xAC") == 1, "3-byte sequence is valid");
    EXPECT(ipc_utf8_valid("\xF0\x9D\x84\x9E") == 1, "4-byte sequence is valid");
    /* Control bytes other than NUL are legal UTF-8; cJSON escapes them. */
    EXPECT(ipc_utf8_valid("a\tb\nc\x01") == 1, "control bytes are valid");
    /* The extremes of each range. */
    EXPECT(ipc_utf8_valid("\xC2\x80") == 1, "U+0080 is valid");
    EXPECT(ipc_utf8_valid("\xDF\xBF") == 1, "U+07FF is valid");
    EXPECT(ipc_utf8_valid("\xE0\xA0\x80") == 1, "U+0800 is valid");
    EXPECT(ipc_utf8_valid("\xEF\xBF\xBF") == 1, "U+FFFF is valid");
    EXPECT(ipc_utf8_valid("\xF0\x90\x80\x80") == 1, "U+10000 is valid");
    EXPECT(ipc_utf8_valid("\xF4\x8F\xBF\xBF") == 1, "U+10FFFF is valid");
    /* Just below and above the surrogate hole. */
    EXPECT(ipc_utf8_valid("\xED\x9F\xBF") == 1, "U+D7FF is valid");
    EXPECT(ipc_utf8_valid("\xEE\x80\x80") == 1, "U+E000 is valid");
}

static void test_valid_is_untouched(void)
{
    /* The property that protects every engine: a valid string survives the
       guard byte for byte, including multi-byte characters and escapables. */
    static const char *const samples[] = {
        "", "plain ascii", "caf\xC3\xA9", "a\"b\\c\nd",
        "\xF0\x9D\x84\x9E ends with 4-byte", "\xC3\xB1\xC3\x91 accents",
    };
    for (size_t i = 0; i < sizeof samples / sizeof samples[0]; i++) {
        cJSON *item = ipc_utf8_string(samples[i]);
        EXPECT(item != NULL, "valid text yields an item");
        if (item != NULL) {
            const char *out = cJSON_GetStringValue(item);
            EXPECT(out != NULL && strcmp(out, samples[i]) == 0,
                   "valid text is byte-for-byte unchanged");
            cJSON_Delete(item);
        }
        /* Repair must be a no-op on valid text too, not just the fast path. */
        expect_repair(samples[i], samples[i], "repair leaves valid text alone");
    }
}

static void test_invalid_is_rejected(void)
{
    /* A lone high byte: Latin-1 'Ñ', the shape that froze the UI in #315. */
    EXPECT(ipc_utf8_valid("\xD1") == 0, "lone 0xD1 is invalid");
    EXPECT(ipc_utf8_valid("Nog\xE1les") == 0, "latin-1 accent is invalid");
    /* Stray continuation byte with no lead. */
    EXPECT(ipc_utf8_valid("\x80") == 0, "lone continuation is invalid");
    EXPECT(ipc_utf8_valid("\xBF") == 0, "lone 0xBF is invalid");
    /* Truncated sequences at the very end of the string. */
    EXPECT(ipc_utf8_valid("\xC3") == 0, "truncated 2-byte is invalid");
    EXPECT(ipc_utf8_valid("\xE2\x82") == 0, "truncated 3-byte is invalid");
    EXPECT(ipc_utf8_valid("\xF0\x9D\x84") == 0, "truncated 4-byte is invalid");
    EXPECT(ipc_utf8_valid("ok\xC3") == 0, "truncated after valid text");
    /* Lead byte followed by a non-continuation. */
    EXPECT(ipc_utf8_valid("\xC3z") == 0, "2-byte lead + ascii is invalid");
    /* Overlong forms: the same code points spelled with too many bytes. */
    EXPECT(ipc_utf8_valid("\xC0\x80") == 0, "overlong NUL is invalid");
    EXPECT(ipc_utf8_valid("\xC1\xBF") == 0, "overlong 0xC1 is invalid");
    EXPECT(ipc_utf8_valid("\xE0\x80\xAF") == 0, "overlong 3-byte is invalid");
    EXPECT(ipc_utf8_valid("\xF0\x80\x80\x80") == 0, "overlong 4-byte is invalid");
    /* UTF-16 surrogates have no UTF-8 encoding. */
    EXPECT(ipc_utf8_valid("\xED\xA0\x80") == 0, "surrogate U+D800 is invalid");
    EXPECT(ipc_utf8_valid("\xED\xBF\xBF") == 0, "surrogate U+DFFF is invalid");
    /* Beyond U+10FFFF. */
    EXPECT(ipc_utf8_valid("\xF4\x90\x80\x80") == 0, "above U+10FFFF is invalid");
    EXPECT(ipc_utf8_valid("\xF5\x80\x80\x80") == 0, "0xF5 lead is invalid");
    EXPECT(ipc_utf8_valid("\xFF") == 0, "0xFF is invalid");
    EXPECT(ipc_utf8_valid("\xFE\xFF") == 0, "UTF-16 BOM bytes are invalid");
}

static void test_repair_keeps_the_good_parts(void)
{
    /* Valid characters survive; each bad byte costs exactly one U+FFFD. */
    expect_repair("\xD1", REPL, "lone bad byte -> one replacement");
    expect_repair("Nog\xE1les", "Nog" REPL "les", "accent inside ascii");
    expect_repair("a\xD1" "b", "a" REPL "b", "bad byte between ascii");
    expect_repair("\x80\x81", REPL REPL, "two bad bytes -> two replacements");
    /* Mixed: a real UTF-8 character next to a broken one. */
    expect_repair("caf\xC3\xA9 \xE1", "caf\xC3\xA9 " REPL,
                  "valid multi-byte survives beside a bad byte");
    /* A truncated sequence at the end costs one replacement per orphan byte. */
    expect_repair("ok\xE2\x82", "ok" REPL REPL, "truncated tail");
    /* Overlong and surrogate forms are replaced, not passed through. */
    expect_repair("\xC0\x80", REPL REPL, "overlong is replaced");
    expect_repair("\xED\xA0\x80", REPL REPL REPL, "surrogate is replaced");
    /* Boundary inputs terminate without reading past the end. */
    expect_repair("", "", "empty repairs to empty");
    EXPECT(ipc_utf8_repair(NULL) == NULL, "NULL repairs to NULL");
}

static void test_repaired_output_is_valid(void)
{
    /* The contract the transport depends on: whatever comes out, cJSON can be
       trusted with it. Sweep every single byte value as a one-byte string. */
    for (int b = 1; b < 256; b++) {
        char in[2] = { (char)b, '\0' };
        char *out = ipc_utf8_repair(in);
        EXPECT(out != NULL, "repair allocates");
        if (out != NULL) {
            if (!ipc_utf8_valid(out)) {
                fprintf(stderr, "FAIL: repair of byte 0x%02X is still invalid\n", b);
                failures++;
            }
            free(out);
        }
    }
    /* And every two-byte combination of high bytes, which is where lead/
       continuation confusion lives. */
    for (int a = 0x80; a < 256; a++) {
        for (int b = 0x80; b < 256; b++) {
            char in[3] = { (char)a, (char)b, '\0' };
            char *out = ipc_utf8_repair(in);
            if (out == NULL || !ipc_utf8_valid(out)) {
                fprintf(stderr, "FAIL: repair of 0x%02X 0x%02X is invalid\n", a, b);
                failures++;
                free(out);
                return;   /* one report is enough */
            }
            free(out);
        }
    }
}

static void test_json_helpers(void)
{
    /* NULL becomes an empty string, so callers need no NULL dance. */
    cJSON *item = ipc_utf8_string(NULL);
    EXPECT(item != NULL, "NULL yields an item");
    if (item != NULL) {
        const char *s = cJSON_GetStringValue(item);
        EXPECT(s != NULL && s[0] == '\0', "NULL yields an empty string");
        cJSON_Delete(item);
    }

    /* An invalid value still serializes, and the printed frame is valid UTF-8 —
       this is the #315 scenario reduced to one assertion. */
    cJSON *obj = cJSON_CreateObject();
    EXPECT(obj != NULL, "object allocates");
    EXPECT(ipc_utf8_add_string(obj, "message", "no existe la tabla \xF3rdenes") != NULL,
           "add_string accepts invalid text");
    char *printed = cJSON_PrintUnformatted(obj);
    EXPECT(printed != NULL, "frame prints");
    if (printed != NULL) {
        EXPECT(ipc_utf8_valid(printed), "printed frame is valid UTF-8");
        /* The readable part of the message survived. */
        EXPECT(strstr(printed, "no existe la tabla ") != NULL,
               "readable text survives in the frame");
        free(printed);
    }
    cJSON_Delete(obj);
}

int main(void)
{
    test_valid_passes();
    test_valid_is_untouched();
    test_invalid_is_rejected();
    test_repair_keeps_the_good_parts();
    test_repaired_output_is_valid();
    test_json_helpers();

    if (failures == 0) {
        printf("utf8_test: all checks passed\n");
    }
    return failures == 0 ? 0 : 1;
}
