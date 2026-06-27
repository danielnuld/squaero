#include "dbcore/dbcore.h"
#include "frontend_assets.h"

#include <stdio.h>

/*
 * Placeholder application shell for M0. It proves the build wiring: the app
 * links libdbcore and the embedded frontend bundle and runs. The webview host
 * that actually displays the bundle lands in issue #3.
 */
int main(void)
{
    printf("Quaero %s — placeholder shell (webview host arrives in #3)\n",
           dbcore_version());
    printf("Embedded frontend bundle: %lu bytes\n",
           (unsigned long)quaero_frontend_html_len);
    return 0;
}
