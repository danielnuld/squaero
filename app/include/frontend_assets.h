#ifndef QUAERO_FRONTEND_ASSETS_H
#define QUAERO_FRONTEND_ASSETS_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * The embedded frontend bundle: a single, self-contained HTML document
 * (JS/CSS inlined). It is NUL-terminated, so it can be used as a C string;
 * `quaero_frontend_html_len` excludes the terminator.
 *
 * Generated at build time — see cmake/EmbedAssets.cmake. The webview host
 * (issue #3) loads this into the OS webview.
 */
extern const unsigned char quaero_frontend_html[];
extern const size_t quaero_frontend_html_len;

#ifdef __cplusplus
}
#endif

#endif /* QUAERO_FRONTEND_ASSETS_H */
