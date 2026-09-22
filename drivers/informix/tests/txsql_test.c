#include "txsql.h"

#include <stdio.h>

/* Transaction statements typed in the editor, which the driver carries out
   itself because DRDA has no BEGIN WORK (issue #557). */

static int failures = 0;
#define EXPECT(cond, msg)                         \
    do {                                          \
        if (!(cond)) {                            \
            fprintf(stderr, "FAIL: %s\n", (msg)); \
            failures++;                           \
        }                                         \
    } while (0)

int main(void)
{
    EXPECT(informix_tx_statement("BEGIN WORK") == IFX_TX_BEGIN, "BEGIN WORK");
    EXPECT(informix_tx_statement("begin") == IFX_TX_BEGIN, "begin");
    EXPECT(informix_tx_statement("  Begin Work ; ") == IFX_TX_BEGIN, "spaces, case, ';'");
    EXPECT(informix_tx_statement("-- start\nBEGIN WORK") == IFX_TX_BEGIN, "after a -- comment");
    EXPECT(informix_tx_statement("{ start } /* x */ begin") == IFX_TX_BEGIN, "after { } and /* */");
    EXPECT(informix_tx_statement("COMMIT WORK;") == IFX_TX_COMMIT, "COMMIT WORK");
    EXPECT(informix_tx_statement("commit") == IFX_TX_COMMIT, "commit");
    EXPECT(informix_tx_statement("ROLLBACK WORK") == IFX_TX_ROLLBACK, "ROLLBACK WORK");
    EXPECT(informix_tx_statement("rollback -- undo\n") == IFX_TX_ROLLBACK, "comment after");

    /* Anything else goes to the server. */
    EXPECT(informix_tx_statement("select * from begin") == IFX_TX_NONE, "select");
    EXPECT(informix_tx_statement("beginning") == IFX_TX_NONE, "a longer word");
    EXPECT(informix_tx_statement("begin_x") == IFX_TX_NONE, "an identifier");
    EXPECT(informix_tx_statement("ROLLBACK WORK TO SAVEPOINT s1") == IFX_TX_NONE, "savepoint");
    EXPECT(informix_tx_statement("commit; select 1") == IFX_TX_NONE, "two statements");
    EXPECT(informix_tx_statement("") == IFX_TX_NONE, "empty");
    EXPECT(informix_tx_statement("/* unclosed") == IFX_TX_NONE, "unclosed comment");
    EXPECT(informix_tx_statement(NULL) == IFX_TX_NONE, "NULL");

    if (failures == 0) {
        printf("OK: informix transaction statements\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
