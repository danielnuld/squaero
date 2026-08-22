// Reading the passwords DBeaver and Navicat store for their own connections, so
// an import brings a connection you can actually open (issue #391).
//
// Both keep their secrets with a FIXED key compiled into the product — not one
// derived from anything the user knows — so "encrypted" here means obfuscated
// against a casual look at the file, not protected against its owner. These are
// the user's own credentials, in files they exported themselves, being moved
// into their own tool; Quaero already stores connection passwords in the clear
// (see connectionStore.ts, a deliberate maintainer decision), so nothing is
// exposed here that was not exposed already.
//
// What each product does:
//
//   - DBeaver keeps `credentials-config.json` beside `data-sources.json`:
//     AES-128-CBC, a zero IV, and the first 16 bytes of the plaintext are a
//     random block to be thrown away. Inside is a map of connection id to
//     `{"#connection": {"user", "password"}}`.
//   - Navicat 12 and later put the password in the `.ncx` attribute itself,
//     hex-encoded, AES-128-CBC with the key and IV that ship in libcc. Navicat
//     11 and earlier used a Blowfish variant instead, which is NOT implemented:
//     an old file decodes to bytes that are not text, and the reader says so
//     rather than storing rubbish as somebody's password.
//
// The keys below are the products' own published constants. They are not
// secrets of ours, and they are the whole reason this can work offline.

/** DBeaver's fixed AES key (`babb4a9f...`), the one its own source carries. */
const DBEAVER_KEY = "babb4a9f774ab853c96c2d653dfe544a";

/** Navicat 12+ ships these two verbatim in libcc. */
const NAVICAT_KEY = "libcckeylibcckey";
const NAVICAT_IV = "libcciv libcciv ";

const utf8 = new TextEncoder();

function fromHex(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * WebCrypto's typings want a Uint8Array proven to sit on an ArrayBuffer rather
 * than a SharedArrayBuffer. Nothing here ever produces a shared one — the cast
 * says that, instead of copying every buffer to prove it to the compiler.
 */
const src = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * AES-CBC decryption that does NOT insist on PKCS#7 padding.
 *
 * WebCrypto always unpads and throws when the padding does not validate, which
 * is no use for a file whose writer padded with zeros — or did not pad at all.
 * The way around it costs six lines: encrypt one extra block of pure padding,
 * chained from the last ciphertext block, and append it. The browser then
 * removes exactly that block and hands back the raw plaintext, whatever the
 * original ending looked like.
 */
async function aesCbcRaw(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("El navegador no expone WebCrypto.");
  const key = await subtle.importKey("raw", src(keyBytes), "AES-CBC", false, ["encrypt", "decrypt"]);
  const lastBlock = data.slice(data.length - 16);
  const padBlock = new Uint8Array(16).fill(16);
  const encrypted = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv: src(lastBlock) }, key, src(padBlock)),
  );
  const combined = concat(data, encrypted.slice(0, 16));
  return new Uint8Array(
    await subtle.decrypt({ name: "AES-CBC", iv: src(iv) }, key, src(combined)),
  );
}

/** Removes PKCS#7 padding when it is valid, trailing zeros when it is not. */
function stripPadding(buf: Uint8Array): Uint8Array {
  const last = buf[buf.length - 1];
  if (last >= 1 && last <= 16 && buf.length >= last) {
    let valid = true;
    for (let i = buf.length - last; i < buf.length; i++) if (buf[i] !== last) valid = false;
    if (valid) return buf.slice(0, buf.length - last);
  }
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end -= 1;
  return buf.slice(0, end);
}

/** True when what came out of the cipher is text a password could be made of. */
function looksLikeText(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // Control characters and the replacement character mean the bytes were not
    // this cipher's plaintext — a Navicat 11 file, most likely.
    if (code < 0x20 || code === 0x7f || code === 0xfffd) return false;
  }
  return true;
}

/** What one DBeaver connection keeps in the credentials file. */
export interface ForeignCredential {
  user?: string;
  password?: string;
}

/**
 * DBeaver's `credentials-config.json`, decrypted into `{connection id: creds}`.
 *
 * Returns an empty map when the file is not one of DBeaver's, or when the key no
 * longer opens it — a wrong guess must not take the whole import down with it.
 */
export async function dbeaverCredentials(
  bytes: ArrayBuffer,
): Promise<Record<string, ForeignCredential>> {
  const data = new Uint8Array(bytes);
  if (data.length < 32 || data.length % 16 !== 0) return {};
  let text: string;
  try {
    const key = fromHex(DBEAVER_KEY)!;
    const raw = await aesCbcRaw(key, new Uint8Array(16), data);
    // The first 16 bytes are the random block DBeaver prepends as its own IV.
    text = new TextDecoder().decode(stripPadding(raw).slice(16));
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out: Record<string, ForeignCredential> = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    // The credentials sit under "#connection"; other keys are per-handler
    // (the SSH tunnel's own password, for instance), which we do not read.
    const conn = (entry as Record<string, unknown>)["#connection"];
    if (!conn || typeof conn !== "object") continue;
    const c = conn as Record<string, unknown>;
    const cred: ForeignCredential = {};
    if (typeof c.user === "string" && c.user !== "") cred.user = c.user;
    if (typeof c.password === "string" && c.password !== "") cred.password = c.password;
    if (cred.user || cred.password) out[id] = cred;
  }
  return out;
}

/**
 * One Navicat password attribute (hex) as plain text, or null when it cannot be
 * read — a Navicat 11 file, a truncated value, or anything that comes out of the
 * cipher not looking like text. Null means "no password", never a wrong one.
 */
export async function navicatPassword(hex: string): Promise<string | null> {
  const data = fromHex(hex);
  if (!data || data.length === 0 || data.length % 16 !== 0) return null;
  try {
    const raw = await aesCbcRaw(utf8.encode(NAVICAT_KEY), utf8.encode(NAVICAT_IV), data);
    const text = new TextDecoder().decode(stripPadding(raw));
    return looksLikeText(text) ? text : null;
  } catch {
    return null;
  }
}
