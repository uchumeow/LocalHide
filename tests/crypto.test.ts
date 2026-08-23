import { describe, it, expect } from "vitest";
import {
    base64ToBytes,
    bytesToBase64,
    deriveKeys,
    generateMasterKey,
    makeKdfParams,
    openJson,
    sealJson,
    timingSafeEqualB64,
    unwrapMasterKey,
    verifierTag,
    wrapMasterKey
} from "../src/crypto/crypto";

const fastKdf = (): ReturnType<typeof makeKdfParams> => ({
    algo: "pbkdf2",
    salt: makeKdfParams().salt,
    iterations: 1000
});

describe("base64 transport encoding", () => {
    it("round-trips arbitrary bytes", () => {
        for (let len = 0; len < 64; len++) {
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len) & 255;
            expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
        }
    });

    it("rejects malformed input", () => {
        expect(() => base64ToBytes("abc!")).toThrow();
        expect(() => base64ToBytes("abcde")).toThrow();
    });
});

describe("password KDF + verifier", () => {
    it("derives stable keys and matching verifiers", () => {
        const kdf = fastKdf();
        const a = deriveKeys("correct horse", kdf);
        const b = deriveKeys("correct horse", kdf);
        expect(verifierTag(a.ver)).toBe(verifierTag(b.ver));
    });

    it("different passwords produce different verifiers", () => {
        const kdf = fastKdf();
        const a = deriveKeys("hunter2hunter2", kdf);
        const b = deriveKeys("hunter2hunter3", kdf);
        expect(verifierTag(a.ver)).not.toBe(verifierTag(b.ver));
    });

    it("different salts produce different verifiers (unique salt per archive)", () => {
        const p1 = deriveKeys("same password", fastKdf());
        const p2 = deriveKeys("same password", fastKdf());
        expect(verifierTag(p1.ver)).not.toBe(verifierTag(p2.ver));
    });
});

describe("timingSafeEqualB64", () => {
    it("matches equal tags only", () => {
        const tag = verifierTag(deriveKeys("pw1234567890", fastKdf()).ver);
        expect(timingSafeEqualB64(tag, tag)).toBe(true);
        expect(timingSafeEqualB64(tag, verifierTag(deriveKeys("other123456789", fastKdf()).ver))).toBe(false);
        expect(timingSafeEqualB64("!!notb64!!", tag)).toBe(false);
    });
});

describe("envelope wrap/unwrap", () => {
    it("wraps and recovers the master key", () => {
        const { kek } = deriveKeys("master pass phrase", fastKdf());
        const master = generateMasterKey();
        const wrapped = wrapMasterKey(master, kek, "channel-123");
        const unwrapped = unwrapMasterKey(wrapped, kek, "channel-123");
        expect(unwrapped).toEqual(master);
    });

    it("fails under the wrong key or context (AEAD auth)", () => {
        const { kek: k1 } = deriveKeys("key one here", fastKdf());
        const { kek: k2 } = deriveKeys("key two here", fastKdf());
        const master = generateMasterKey();
        const wrapped = wrapMasterKey(master, k1, "channel-123");
        expect(() => unwrapMasterKey(wrapped, k2, "channel-123")).toThrow();
        expect(() => unwrapMasterKey(wrapped, k1, "channel-999")).toThrow();
    });

    it("never reuses nonces across seals", () => {
        const key = generateMasterKey();
        const a = sealJson(key, "ch1", { hello: "world" });
        const b = sealJson(key, "ch1", { hello: "world" });
        expect(a.ct).not.toBe(b.ct); // fresh random nonce each time
    });
});

describe("sealed JSON payloads", () => {
    it("round-trips archive payloads", () => {
        const key = generateMasterKey();
        const payload = { messages: [{ id: "42", content: "hi :3" }] };
        const sealed = sealJson(key, "555", payload);
        expect(openJson(key, "555", sealed)).toEqual(payload);
    });

    it("binds ciphertext to the channel id (AAD)", () => {
        const key = generateMasterKey();
        const sealed = sealJson(key, "555", { messages: [] });
        expect(() => openJson(key, "556", sealed)).toThrow();
    });

    it("cannot be opened with the wrong master key", () => {
        const sealed = sealJson(generateMasterKey(), "555", { messages: [] });
        expect(() => openJson(generateMasterKey(), "555", sealed)).toThrow();
    });
});
