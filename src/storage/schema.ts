/**
 * LocalHide storage schema, versioned from day one.
 *
 * schemaVersion 1:
 *   state.json            - plaintext index: conversation metadata + hidden ids
 *   archive.<channel>.json - per-conversation encrypted record (see archives.ts)
 */

export const SCHEMA_VERSION = 1;

export const STATE_PATH = "state.json";
export const archivePath = (channelId: string) => `archive.${channelId}.json`;

export interface StoredAttachmentMeta {
    filename?: string;
    contentType?: string | null;
    size?: number | null;
    url?: string | null;
}

export interface StoredReplyMeta {
    messageId: string;
    authorName?: string;
    contentPreview?: string;
}

export interface StoredEmbedMeta {
    title?: string;
    description?: string;
}

export interface ArchivedMessage {
    id: string;
    channelId: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: string;
    editedTimestamp?: string | null;
    /** true when authored by the local user */
    outgoing: boolean;
    type?: number;
    reply?: StoredReplyMeta | null;
    attachments?: StoredAttachmentMeta[];
    embeds?: StoredEmbedMeta[];
    hiddenAt: number;
}

export interface ArchiveDataPayload {
    messages: ArchivedMessage[];
}

export interface KdfParamsStored {
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

/** Everything stored in archive.<channelId>.json. No secrets in plaintext. */
export interface ArchiveRecord {
    schemaVersion: number;
    channelId: string;
    userId: string | null;
    kdf: KdfParamsStored;
    verifier: string;
    wrap: SealedBlob;
    /** master key sealed under the device key (password-free hide path) */
    devWrap?: SealedBlob | null;
    data: SealedBlob;
    count: number;
    createdAt: number;
    updatedAt: number;
}

export interface IndexConversation {
    userId: string | null;
    displayName: string | null;
    count: number;
    createdAt: number;
    updatedAt: number;
}

export interface StateData {
    schemaVersion: number;
    conversations: Record<string, IndexConversation>;
    hiddenIds: Record<string, string[]>;
}

export function emptyState(): StateData {
    return {
        schemaVersion: SCHEMA_VERSION,
        conversations: {},
        hiddenIds: {}
    };
}

function isObj(v: unknown): v is AnyDict {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
interface AnyDict {
    [k: string]: unknown;
}

const isSnowflakeish = (v: unknown): v is string =>
    typeof v === "string" && /^\d{5,25}$/.test(v);

const isB64 = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && /^[A-Za-z0-9+/=]+$/.test(v);

/** Validate a loaded state.json; throws on structural corruption. */
export function validateState(raw: unknown): StateData {
    if (!isObj(raw)) throw new Error("LocalHide: state.json is not an object");
    if (typeof raw.schemaVersion !== "number" || raw.schemaVersion < 1) {
        throw new Error("LocalHide: state.json has invalid schemaVersion");
    }
    const conversations: Record<string, IndexConversation> = {};
    if (isObj(raw.conversations)) {
        for (const [channelId, c] of Object.entries(raw.conversations)) {
            if (!isSnowflakeish(channelId) || !isObj(c)) continue;
            conversations[channelId] = {
                userId: typeof c.userId === "string" ? c.userId : null,
                displayName: typeof c.displayName === "string" ? c.displayName : null,
                count: typeof c.count === "number" && Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : 0,
                createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
                updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now()
            };
        }
    }
    const hiddenIds: Record<string, string[]> = {};
    if (isObj(raw.hiddenIds)) {
        for (const [channelId, ids] of Object.entries(raw.hiddenIds)) {
            if (!isSnowflakeish(channelId) || !Array.isArray(ids)) continue;
            const clean = [...new Set(ids.filter(isSnowflakeish))];
            if (clean.length) hiddenIds[channelId] = clean;
        }
    }
    return { schemaVersion: SCHEMA_VERSION, conversations, hiddenIds };
}

/** Validate an archive record header; throws on corruption. */
export function validateArchiveRecord(raw: unknown): ArchiveRecord {
    if (!isObj(raw)) throw new Error("archive record is not an object");
    if (!isSnowflakeish(raw.channelId)) throw new Error("archive record has invalid channelId");
    const kdfRaw = raw.kdf;
    if (
        !isObj(kdfRaw) ||
        kdfRaw.algo !== "scrypt" ||
        !isB64(kdfRaw.salt) ||
        typeof kdfRaw.N !== "number" ||
        typeof kdfRaw.r !== "number" ||
        typeof kdfRaw.p !== "number" ||
        kdfRaw.N < 1 ||
        kdfRaw.r < 1 ||
        kdfRaw.p < 1
    ) {
        throw new Error("archive record has bad kdf params");
    }
    if (!isB64(raw.verifier)) throw new Error("archive record has bad verifier");
    for (const blobKey of ["wrap", "data"] as const) {
        const b = raw[blobKey];
        if (!isObj(b) || b.algo !== "xchacha20poly1305" || !isB64(b.ct)) {
            throw new Error(`archive record has bad ${blobKey} blob`);
        }
    }
    const devWrapRaw = raw.devWrap;
    const devWrap =
        isObj(devWrapRaw) && devWrapRaw.algo === "xchacha20poly1305" && isB64(devWrapRaw.ct)
            ? ({ algo: "xchacha20poly1305", ct: devWrapRaw.ct } as SealedBlob)
            : null;
    const rec: ArchiveRecord = {
        schemaVersion: SCHEMA_VERSION,
        channelId: raw.channelId,
        userId: isSnowflakeish(raw.userId) ? raw.userId : null,
        kdf: {
            algo: "scrypt",
            salt: kdfRaw.salt,
            N: kdfRaw.N,
            r: kdfRaw.r,
            p: kdfRaw.p
        },
        verifier: raw.verifier,
        wrap: { algo: "xchacha20poly1305", ct: (raw.wrap as { ct: string }).ct },
        devWrap,
        data: { algo: "xchacha20poly1305", ct: (raw.data as { ct: string }).ct },
        count: typeof raw.count === "number" && raw.count >= 0 ? raw.count : 0,
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now()
    };
    if (typeof raw.schemaVersion === "number" && raw.schemaVersion !== SCHEMA_VERSION) {
        // Future versions must be migrated before use; loader handles that.
        rec.schemaVersion = raw.schemaVersion;
    }
    return rec;
}
