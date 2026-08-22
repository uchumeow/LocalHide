import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { scrypt } from "@noble/hashes/scrypt";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Cryptography for LocalHide archives.
 *
 * - KDF: scrypt (N=32768, r=8, p=1) over the user's password with a random
 *   16-byte salt per archive. No password is ever stored or logged.
 * - The scrypt output is split via HKDF-SHA256 into two independent keys:
 *     * KEK ("localhide/hkdf/kek") - wraps/unwraps the archive master key
 *     * VER ("localhide/hkdf/ver") - produces the stored password verifier
 * - Archive master key: random 32 bytes per archive (envelope encryption).
 *   Snapshots are encrypted under the master key so hiding never needs the
 *   password; only unlocking does.
 * - AEAD: XChaCha20-Poly1305 (@noble/ciphers), fresh random 24-byte nonce per
 *   encryption (nonce is stored prefixed to each ciphertext), AAD binding each
 *   ciphertext to its record.
 *
 * All primitives come from audited pure-JS libraries (@noble family);
 * LocalHide implements no cryptography of its own beyond wiring. Base64 here
 * is transport encoding for JSON storage only, never "encryption".
 */

export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 24;

export interface KdfParams {
    algo: "scrypt";
    salt: string;
    N: number;
    r: number;
    p: number;
}

export interface SealedBlob {
    algo: "xchacha20poly1305";
    ct: string;
}

// --- base64 transport encoding ----------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
    let out = "";
    let i = 0;
    const len = bytes.length;
    const end = len - (len % 3);
    while (i < end) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
        i += 3;
    }
    if (end === len - 1) {
        const n = bytes[i] << 16;
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
    } else if (end === len - 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
    }
    return out;
}

const B64_LOOKUP = (() => {
    const t = new Int8Array(128).fill(-1);
    for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
    return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
    if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        throw new Error("invalid base64");
    }
    let padding = 0;
    if (b64.endsWith("==")) padding = 2;
    else if (b64.endsWith("=")) padding = 1;
    const len = (b64.length / 4) * 3 - padding;
    const out = new Uint8Array(len);
    let p = 0;
    for (let i = 0; i < b64.length; i += 4) {
        const a = B64_LOOKUP[b64.charCodeAt(i)];
        const b = B64_LOOKUP[b64.charCodeAt(i + 1)];
        const cRaw = b64.charCodeAt(i + 2);
        const dRaw = b64.charCodeAt(i + 3);
        const c = cRaw === 61 ? 0 : B64_LOOKUP[cRaw]; // '=' -> 0
        const d = dRaw === 61 ? 0 : B64_LOOKUP[dRaw];
        if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("invalid base64");
        const n = (a << 18) | (b << 12) | ((c as number) << 6) | (d as number);
        if (p < len) out[p++] = (n >> 16) & 255;
        if (p < len) out[p++] = (n >> 8) & 255;
        if (p < len) out[p++] = n & 255;
    }
    return out;
}

// --- KDF ----------------------------------------------------------------------

export function randomSaltB64(): string {
    return bytesToBase64(randomBytes(SALT_LEN));
}

export function makeKdfParams(): KdfParams {
    return { algo: "scrypt", salt: randomSaltB64(), N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };
}

export function deriveKeys(password: string, kdf: KdfParams): { kek: Uint8Array; ver: Uint8Array } {
    const pw = utf8ToBytes(password.normalize("NFKC"));
    const salt = base64ToBytes(kdf.salt);
    const master = scrypt(pw, salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: KEY_LEN });
    return {
        kek: hkdf(sha256, master, new Uint8Array(0), utf8ToBytes("localhide/hkdf/kek"), KEY_LEN),
        ver: hkdf(sha256, master, new Uint8Array(0), utf8ToBytes("localhide/hkdf/ver"), KEY_LEN)
    };
}

const VERIFIER_INFO = "localhide/password-verifier/v1";

export function verifierTag(verKey: Uint8Array): string {
    return bytesToBase64(hmac(sha256, verKey, utf8ToBytes(VERIFIER_INFO)));
}

/** Length-independent constant-time comparison of two b64 byte strings. */
export function timingSafeEqualB64(aB64: string, bB64: string): boolean {
    let a: Uint8Array;
    let b: Uint8Array;
    try {
        a = base64ToBytes(aB64);
        b = base64ToBytes(bB64);
    } catch {
        return false;
    }
    if (a.length !== b.length || a.length === 0) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

// --- AEAD ---------------------------------------------------------------------

function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): string {
    const nonce = randomBytes(NONCE_LEN);
    const cipher = xchacha20poly1305(key, nonce, utf8ToBytes(aad));
    const ct = cipher.encrypt(plaintext);
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    return bytesToBase64(out);
}

function open(key: Uint8Array, blobB64: string, aad: string): Uint8Array {
    const blob = base64ToBytes(blobB64);
    if (blob.length <= NONCE_LEN) throw new Error("ciphertext too short");
    const nonce = blob.slice(0, NONCE_LEN);
    const ct = blob.slice(NONCE_LEN);
    const cipher = xchacha20poly1305(key, nonce, utf8ToBytes(aad));
    return cipher.decrypt(ct);
}

// --- envelope -----------------------------------------------------------------

export function generateMasterKey(): Uint8Array {
    return randomBytes(KEY_LEN);
}

export function generateDeviceKeyB64(): string {
    return bytesToBase64(randomBytes(KEY_LEN));
}

export function decodeKeyB64(keyB64: string): Uint8Array {
    const key = base64ToBytes(keyB64);
    if (key.length !== KEY_LEN) throw new Error("bad key length");
    return key;
}

/** Wrap the archive master key under an external key (password KEK / device key). */
export function wrapMasterKey(masterKey: Uint8Array, wrapKey: Uint8Array, context: string): string {
    return seal(wrapKey, masterKey, `localhide/wrap/${context}`);
}

export function unwrapMasterKey(wrappedCt: string, wrapKey: Uint8Array, context: string): Uint8Array {
    return open(wrapKey, wrappedCt, `localhide/wrap/${context}`);
}

/** Encrypt a JSON payload under the archive master key. */
export function sealJson(masterKey: Uint8Array, channelId: string, payload: unknown): SealedBlob {
    const json = JSON.stringify(payload);
    return {
        algo: "xchacha20poly1305",
        ct: seal(masterKey, utf8ToBytes(json), `localhide/data/${channelId}/v1`)
    };
}

export function openJson<T>(masterKey: Uint8Array, channelId: string, sealed: SealedBlob): T {
    const bytes = open(masterKey, channelId ? sealed.ct : sealed.ct, `localhide/data/${channelId}/v1`);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
