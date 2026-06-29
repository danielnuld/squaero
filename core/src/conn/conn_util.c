#include "conn_util.h"

#include <string.h>

void conn_copy_err(char *buf, size_t cap, const char *msg)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    if (msg == NULL) {
        msg = "unknown error";
    }
    size_t n = strlen(msg);
    if (n >= cap) {
        n = cap - 1;
    }
    memcpy(buf, msg, n);
    buf[n] = '\0';
}
