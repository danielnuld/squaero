#include "cancel_tag.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the cancel tag. Pure: no libbson/mongoc. */

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
    char a[64], b[64], small[12];

    int n = mongo_cancel_tag(a, sizeof a, "65a1b2c3d4e5f60718293a4b");
    EXPECT(n > 0 && strcmp(a, "quaero-cancel-65a1b2c3d4e5f60718293a4b") == 0 &&
               (size_t)n == strlen(a),
           "the tag is the prefix plus the unique id");
    EXPECT(mongo_cancel_tag_is(a), "a built tag is recognised");

    mongo_cancel_tag(b, sizeof b, "65a1b2c3d4e5f60718293a4c");
    EXPECT(strcmp(a, b) != 0, "another connection (another id) gets another tag");

    EXPECT(mongo_cancel_tag(small, sizeof small, "65a1b2c3d4e5f60718293a4b") == -1 &&
               small[0] == '\0',
           "a buffer that is too small is refused, not truncated");
    EXPECT(mongo_cancel_tag(NULL, 10, "x") == -1, "NULL buffer refused");
    EXPECT(mongo_cancel_tag(a, 0, "x") == -1, "zero capacity refused");
    EXPECT(mongo_cancel_tag(a, sizeof a, NULL) == -1 && a[0] == '\0', "NULL id refused");
    EXPECT(mongo_cancel_tag(a, sizeof a, "") == -1, "empty id refused");
    EXPECT(mongo_cancel_tag(a, sizeof a, "a\"b") == -1, "a quote in the id is refused");
    EXPECT(mongo_cancel_tag(a, sizeof a, "a b") == -1, "a space in the id is refused");
    EXPECT(mongo_cancel_tag(a, sizeof a, "ab-c_9") == 14 + 6, "dash, underscore and digits are fine");

    EXPECT(!mongo_cancel_tag_is(NULL), "NULL is not a tag");
    EXPECT(!mongo_cancel_tag_is(""), "empty is not a tag");
    EXPECT(!mongo_cancel_tag_is("quaero-cancel-"), "the bare prefix is not a tag");
    EXPECT(!mongo_cancel_tag_is("a user comment"), "a user's own comment is not a tag");

    if (failures == 0) {
        printf("OK: mongodb cancel tag (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
