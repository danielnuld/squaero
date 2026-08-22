import { describe, it, expect } from "vitest";
import { dbeaverCredentials, navicatPassword } from "../../src/utils/foreignSecrets";

// Issue #391. These vectors are BUILT HERE, by encrypting with the same constants
// the readers decrypt with, so what they prove is that the decryption path is a
// correct inverse of a standard AES-CBC encryption — the part that can be
// verified without the other products on the machine.
//
// What they cannot prove is that DBeaver and Navicat really use these keys. That
// is knowledge from each product's own published constants, and it only becomes
// a fact when a real exported file goes through this. Until then the readers are
// written to FAIL QUIETLY: a wrong key yields bytes that are not text, and both
// return "no password" rather than storing rubbish as somebody's credential —
// which is exactly what the last test in each block checks.

const utf8 = new TextEncoder();

const DBEAVER_KEY = Uint8Array.from(
  "babb4a9f774ab853c96c2d653dfe544a".match(/../g)!.map((b) => parseInt(b, 16)),
);

/** Encrypts like the product does, to produce a file the reader has to open. */
async function encrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plain: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    "AES-CBC",
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: iv as unknown as BufferSource },
      key,
      plain as unknown as BufferSource,
    ),
  );
}

/** A credentials-config.json as DBeaver writes it: 16 junk bytes, then JSON. */
async function dbeaverFile(payload: unknown): Promise<ArrayBuffer> {
  const json = utf8.encode(JSON.stringify(payload));
  const plain = new Uint8Array(16 + json.length);
  plain.set(utf8.encode("0123456789abcdef"), 0); // the block DBeaver throws away
  plain.set(json, 16);
  const out = await encrypt(DBEAVER_KEY, new Uint8Array(16), plain);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** A Navicat 12 password attribute: AES-CBC with libcc's key/IV, hex-encoded. */
async function navicatHex(password: string): Promise<string> {
  const out = await encrypt(
    utf8.encode("libcckeylibcckey"),
    utf8.encode("libcciv libcciv "),
    utf8.encode(password),
  );
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("dbeaverCredentials", () => {
  it("reads the user and password of each connection, keyed by DBeaver's id", async () => {
    const file = await dbeaverFile({
      "postgres-jdbc-18f2": { "#connection": { user: "app", password: "hunter2" } },
      "mysql8-1a2b": { "#connection": { user: "root", password: "s3cr3t" } },
    });
    expect(await dbeaverCredentials(file)).toEqual({
      "postgres-jdbc-18f2": { user: "app", password: "hunter2" },
      "mysql8-1a2b": { user: "root", password: "s3cr3t" },
    });
  });

  it("reads only the connection's own credentials, not a handler's", async () => {
    const file = await dbeaverFile({
      a: {
        "#connection": { user: "app" },
        ssh_tunnel: { user: "jump", password: "tunnel-secret" },
      },
    });
    const out = await dbeaverCredentials(file);
    expect(out).toEqual({ a: { user: "app" } });
    expect(JSON.stringify(out)).not.toContain("tunnel-secret");
  });

  it("gives nothing back rather than throwing when the file is not one of its own", async () => {
    // A wrong key, a truncated file and plain text all end the same way: no
    // credentials, and an import that still brings the addresses across.
    const wrongKey = await encrypt(new Uint8Array(16), new Uint8Array(16), utf8.encode("x".repeat(64)));
    expect(await dbeaverCredentials(wrongKey.buffer as ArrayBuffer)).toEqual({});
    expect(await dbeaverCredentials(new Uint8Array(8).buffer)).toEqual({});
    expect(await dbeaverCredentials(utf8.encode("{}").buffer as ArrayBuffer)).toEqual({});
  });
});

describe("navicatPassword", () => {
  it("reads a password back", async () => {
    for (const secret of ["hunter2", "", "unaContraseñaMuchoMásLargaQueUnBloque"]) {
      if (secret === "") continue;
      expect(await navicatPassword(await navicatHex(secret))).toBe(secret);
    }
  });

  it("survives a value that is exactly one block long", async () => {
    const exact = "0123456789abcdef";
    expect(await navicatPassword(await navicatHex(exact))).toBe(exact);
  });

  it("says nothing when the value is not a Navicat 12 blob", async () => {
    // An old (Blowfish) file, a truncated value, junk: never a wrong password.
    expect(await navicatPassword("A3F2C1")).toBeNull();
    expect(await navicatPassword("")).toBeNull();
    expect(await navicatPassword("no soy hexadecimal")).toBeNull();
    expect(await navicatPassword("00112233445566778899aabbccddeeff")).toBeNull();
  });
});
