#include "ssh_tunnel.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Whole contents of `path`, NUL-terminated, or "" when it cannot be read. */
static const char *slurp(const char *path)
{
    static char buf[1024];
    buf[0] = '\0';
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return buf;
    }
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    buf[n] = '\0';
    fclose(f);
    return buf;
}

static void write_file(const char *path, const char *text)
{
    FILE *f = fopen(path, "wb");
    if (f != NULL) {
        fputs(text, f);
        fclose(f);
    }
}

int main(void)
{
    const char *path = "known_hosts_append_test.tmp";
    const char *line = "host.example ssh-rsa AAAAKEY added by quaero\n";

    /* --- nominal: an existing store keeps every line it already had --- */
    {
        remove(path);
        write_file(path,
                   "# a comment libssh2 cannot parse\n"
                   "@cert-authority *.example ssh-ed25519 AAAACA\n"
                   "other.example sk-ssh-ed25519@openssh.com AAAASK\n");
        EXPECT(ssh_known_hosts_append(path, line) == 0, "append succeeds");
        const char *got = slurp(path);
        EXPECT(strstr(got, "# a comment") != NULL, "comment survives");
        EXPECT(strstr(got, "@cert-authority") != NULL, "marker survives");
        EXPECT(strstr(got, "sk-ssh-ed25519@openssh.com") != NULL,
               "unsupported key type survives");
        EXPECT(strstr(got, line) != NULL, "the new key is there");
    }

    /* --- edge: a store whose last line has no newline is not glued onto --- */
    {
        remove(path);
        write_file(path, "first.example ssh-rsa AAAAFIRST");
        EXPECT(ssh_known_hosts_append(path, line) == 0, "append succeeds");
        EXPECT(strcmp(slurp(path),
                      "first.example ssh-rsa AAAAFIRST\n"
                      "host.example ssh-rsa AAAAKEY added by quaero\n") == 0,
               "a newline is inserted first");
    }

    /* --- edge: no store yet => the file is created with just that line --- */
    {
        remove(path);
        EXPECT(ssh_known_hosts_append(path, line) == 0, "append creates");
        EXPECT(strcmp(slurp(path), line) == 0, "only the new line");
    }

    /* --- edge: appending twice keeps both, in order --- */
    {
        EXPECT(ssh_known_hosts_append(path, "second.example ssh-rsa AAAA2\n") == 0,
               "second append succeeds");
        EXPECT(strcmp(slurp(path),
                      "host.example ssh-rsa AAAAKEY added by quaero\n"
                      "second.example ssh-rsa AAAA2\n") == 0,
               "both lines, in order");
    }

    /* --- unsupported: a path that cannot be opened reports failure --- */
    {
        EXPECT(ssh_known_hosts_append("no_such_dir/nope/known_hosts", line) == -1,
               "unopenable path fails");
    }

    remove(path);
    if (failures == 0) {
        printf("OK: known_hosts append (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
