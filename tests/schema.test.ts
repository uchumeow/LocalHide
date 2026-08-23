import { describe, it, expect } from "vitest";
import {
    emptyState,
    SCHEMA_VERSION,
    validateArchiveRecord,
    validateState
} from "../src/storage/schema";
import { migrateState } from "../src/storage/migrate";

const CH = "123456789012345678";
const validRecord = () => ({
    schemaVersion: SCHEMA_VERSION,
    channelId: CH,
    userId: "234567890123456789",
    kdf: { algo: "pbkdf2", salt: "AAAAAAAAAAAAAAAAAAAAAA==", iterations: 600000 },
    verifier: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=",
    wrap: { algo: "xchacha20poly1305", ct: "QUJDRA==" },
    devWrap: { algo: "xchacha20poly1305", ct: "REVGRw==" },
    data: { algo: "xchacha20poly1305", ct: "R0hJSg==" },
    count: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
});

describe("validateState", () => {
    it("accepts a well-formed state", () => {
        const s = emptyState();
        expect(validateState(s).schemaVersion).toBe(SCHEMA_VERSION);
    });

    it("drops malformed conversation entries instead of crashing", () => {
        const raw = {
            schemaVersion: 1,
            conversations: {
                [CH]: { userId: "u", displayName: null, count: 2, createdAt: 1, updatedAt: 2 },
                bad_channel: { count: 5 },
                [CH + "0"]: { userId: 42, count: "nope" }
            },
            hiddenIds: {
                [CH]: ["111111111111111111", "not-a-snowflake", "222222222222222222", "111111111111111111"],
                nope: ["333333333333333333"]
            }
        };
        const state = validateState(raw);
        expect(Object.keys(state.conversations)).toHaveLength(2);
        expect(state.hiddenIds[CH]).toEqual(["111111111111111111", "222222222222222222"]);
        expect(state.hiddenIds.nope).toBeUndefined();
        // invalid count coerced to 0, never negative
        expect(state.conversations[CH + "0"].count).toBe(0);
    });

    it("throws on non-objects and missing version", () => {
        expect(() => validateState(null)).toThrow();
        expect(() => validateState([])).toThrow();
        expect(() => validateState({})).toThrow();
    });
});

describe("validateArchiveRecord", () => {
    it("accepts a complete record with devWrap", () => {
        const rec = validateArchiveRecord(validRecord());
        expect(rec.channelId).toBe(CH);
        expect(rec.devWrap?.algo).toBe("xchacha20poly1305");
    });

    it("tolerates missing devWrap (older/failed device key)", () => {
        const { devWrap, ...rest } = validRecord() as any;
        expect(validateArchiveRecord(rest).devWrap).toBeNull();
        expect(validateArchiveRecord({ ...validRecord(), devWrap: null }).devWrap).toBeNull();
        expect(validateArchiveRecord({ ...validRecord(), devWrap: { algo: "bogus", ct: "QQ==" } }).devWrap).toBeNull();
    });

    it("rejects corruption in each critical field", () => {
        expect(() => validateArchiveRecord({ ...validRecord(), channelId: "nope" })).toThrow();
        expect(() => validateArchiveRecord({ ...validRecord(), kdf: { ...validRecord().kdf, algo: "scrypt" } })).toThrow();
        expect(() =>
            validateArchiveRecord({ ...validRecord(), kdf: { ...validRecord().kdf, iterations: 1000 } })
        ).toThrow();
        expect(() => validateArchiveRecord({ ...validRecord(), verifier: "" })).toThrow();
        expect(() => validateArchiveRecord({ ...validRecord(), wrap: { algo: "x", ct: "!!" } })).toThrow();
        expect(() => validateArchiveRecord({ ...validRecord(), data: undefined })).toThrow();
    });
});

describe("migrateState", () => {
    it("passes current-version state through unchanged", () => {
        const raw = { schemaVersion: SCHEMA_VERSION, conversations: {}, hiddenIds: {} };
        expect(migrateState(raw)).toEqual(emptyState());
    });

    it("refuses states from the future instead of corrupting them", () => {
        const raw = { schemaVersion: SCHEMA_VERSION + 5, conversations: {}, hiddenIds: {} };
        expect(() => migrateState(raw)).toThrow(/newer than this plugin/);
    });

    it("throws on garbage", () => {
        expect(() => migrateState("junk")).toThrow();
    });
});
