#include "cancel_tag.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#define TAG_PREFIX "quaero-cancel-"

int mongo_cancel_tag(char *buf, size_t cap, const char *unique)
{
    if (buf == NULL || cap == 0) {
        return -1;
    }
    buf[0] = '\0';
    if (unique == NULL || unique[0] == '\0') {
        return -1;
    }
    for (const char *p = unique; *p != '\0'; p++) {
        if (!isalnum((unsigned char)*p) && *p != '-' && *p != '_') {
            return -1;
        }
    }
    int n = snprintf(buf, cap, TAG_PREFIX "%s", unique);
    if (n < 0 || (size_t)n >= cap) {
        buf[0] = '\0';
        return -1;
    }
    return n;
}

int mongo_cancel_tag_is(const char *comment)
{
    return comment != NULL && strncmp(comment, TAG_PREFIX, strlen(TAG_PREFIX)) == 0 &&
           comment[strlen(TAG_PREFIX)] != '\0';
}
