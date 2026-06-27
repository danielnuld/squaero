#include "dbcore/dbcore.h"

#include <stdio.h>

/*
 * Placeholder application shell for M0. It only proves the build wiring:
 * the app links libdbcore and runs. The webview host lands in issue #3.
 */
int main(void)
{
    printf("Quaero %s — placeholder shell (webview host arrives in #3)\n",
           dbcore_version());
    return 0;
}
