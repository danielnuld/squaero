#include "frontend_assets.h"

#include <stdio.h>
#include <string.h>

/* Verifies the embedded frontend bundle is present, well-formed and usable as
   a C string. Works with both the real dist bundle and the placeholder. */
int main(void)
{
    if (quaero_frontend_html_len == 0) {
        fprintf(stderr, "FAIL: embedded bundle is empty\n");
        return 1;
    }

    /* NUL-terminated for use as a C string; len excludes the terminator. */
    if (quaero_frontend_html[quaero_frontend_html_len] != 0x00) {
        fprintf(stderr, "FAIL: bundle is not NUL-terminated\n");
        return 1;
    }

    if (strlen((const char *)quaero_frontend_html) != quaero_frontend_html_len) {
        fprintf(stderr, "FAIL: length does not match strlen\n");
        return 1;
    }

    if (strstr((const char *)quaero_frontend_html, "<") == NULL) {
        fprintf(stderr, "FAIL: bundle does not look like HTML\n");
        return 1;
    }

    printf("OK: embedded bundle = %lu bytes\n",
           (unsigned long)quaero_frontend_html_len);
    return 0;
}
