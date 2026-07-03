#include "value_fmt.h"

#include <stdio.h>

void mongo_format_datetime(int64_t millis, char *buf, size_t len)
{
    if (buf == NULL || len == 0) {
        return;
    }

    /* Split into whole seconds + a 0..999 millisecond remainder, flooring
       toward negative infinity so pre-epoch instants format correctly. */
    int64_t secs = millis / 1000;
    int ms = (int)(millis % 1000);
    if (ms < 0) {
        ms += 1000;
        secs -= 1;
    }

    int64_t days = secs / 86400;
    int64_t tod = secs % 86400;   /* seconds within the day */
    if (tod < 0) {
        tod += 86400;
        days -= 1;
    }
    int hh = (int)(tod / 3600);
    int mm = (int)((tod % 3600) / 60);
    int ss = (int)(tod % 60);

    /* civil_from_days: days are counted from 1970-01-01 (Howard Hinnant's
       public-domain algorithm), shifted to an era starting 0000-03-01. */
    int64_t z = days + 719468;
    int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    unsigned doe = (unsigned)(z - era * 146097);              /* [0, 146096] */
    unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int64_t y = (int64_t)yoe + era * 400;
    unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);   /* [0, 365] */
    unsigned mp = (5 * doy + 2) / 153;                         /* [0, 11] */
    unsigned d = doy - (153 * mp + 2) / 5 + 1;                 /* [1, 31] */
    unsigned m = mp < 10 ? mp + 3 : mp - 9;                    /* [1, 12] */
    y += (m <= 2);

    snprintf(buf, len, "%04lld-%02d-%02dT%02d:%02d:%02d.%03dZ",
             (long long)y, (int)m, (int)d, hh, mm, ss, ms);
}
