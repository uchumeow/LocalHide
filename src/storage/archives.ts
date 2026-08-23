import {
    decodeKeyB64,
    deriveKeys,
    generateDeviceKeyB64,
    generateMasterKey,
    makeKdfParams,
    openJson,
    sealJson,
    timingSafeEqualB64,
    unwrapMasterKey,
    verifierTag,
    wrapMasterKey
} from "../crypto/crypto";
import { createFsAdapter, writeQueue, traceStep, type FsAdapter } from "./fs";
import {
    archivePath,
    SCHEMA_VERSION,
    validateArchiveRecord,
    type ArchiveDataPayload,
    type ArchiveRecord,
    type ArchivedMessage,
    type SealedBlob
} from "./schema";
import type { SnapshotInput } from "../lib/snapshot";
import { stateStore as defaultStateStore, StateStore } from "./store";
import { dbg, log, warn } from "../lib/logger";

/**
 * Encrypted per-conversation archives (envelope encryption).
 *
 * Layout of archive.<channelId>.json:
 *   kdf       - scrypt params + salt for the password-derived key
 *   verifier  - HKDF/HMAC tag proving the password without storing it
 *   wrap      - archive master key sealed under password KEK   (unlock path)
 *   devWrap   - same master key sealed under a device key      (hide path)
 *   data      - AEAD-sealed JSON payload of ArchivedMessage[]
 *
 * The dual wrap exists because LocalHide must let you hide messages without
 * re-entering a password (even right after an app restart), while keeping
 * readable snapshots encrypted at rest and password-gated in the UI. The
 * device key lives in the plugin's own storage directory; see SECURITY.md for
 * the threat-model discussion of this tradeoff.
 *
 * Consistency protocol:
 *   hide:    write archive blob first, then state index. A crash in between
 *            leaves an orphan snapshot inside the encrypted blob only.
 *   restore: update state first, then rewrite the blob. A crash can only
 *            leave a still-viewable snapshot; the DM is already unhidden.
 */

const DEVICE_PATH = "device.json";

interface DeviceKeyFile {
    schemaVersion: number;
    key: string;
    createdAt: number;
}

export class ArchiveManager {
    private fs: FsAdapter | null;
    private enqueue: ReturnType<typeof writeQueue>;
    private state: StateStore;

    // unwrapped master keys held in memory only while LocalHide runs
    private sessionKeys: Map<string, Uint8Array>;
    private deviceKeyPromise: Promise<Uint8Array | null> | null;

    private injectedFs: FsAdapter | null | undefined;

    constructor(
        injectedFs?: FsAdapter | null,
        injectedState?: StateStore
    ) {
        // NOTE: explicit constructor assignment - see StateStore note
        this.injectedFs = injectedFs;
        this.fs = injectedFs !== undefined ? injectedFs : createFsAdapter();
        this.enqueue = writeQueue();
        this.state = injectedState ?? defaultStateStore;
        this.sessionKeys = new Map<string, Uint8Array>();
        this.deviceKeyPromise = null;
    }

    init(): void {
        this.fs = this.injectedFs !== undefined ? this.injectedFs : createFsAdapter();
        if (!this.fs) warn("native file module unavailable; archives disabled");
    }

    hasArchive(channelId: string): boolean {
        return this.state.getConversation(channelId) !== null;
    }

    getMetadata(channelId: string) {
        return this.state.getConversation(channelId);
    }

    async destroySessionKeys(): Promise<void> {
        this.sessionKeys.clear();
        this.deviceKeyPromise = null;
    }

    // --- device key -----------------------------------------------------------

    private async getDeviceKey(): Promise<Uint8Array | null> {
        if (!this.fs) return null;
        if (!this.deviceKeyPromise) {
            this.deviceKeyPromise = (async () => {
                try {
                    let file: DeviceKeyFile | null = null;
                    if (await this.fs!.exists(DEVICE_PATH)) {
                        const raw = (await this.fs!.readJson(DEVICE_PATH)) as Partial<DeviceKeyFile>;
                        if (raw && typeof raw.key === "string" && raw.schemaVersion === SCHEMA_VERSION) {
                            file = raw as DeviceKeyFile;
                        }
                    }
                    if (!file) {
                        file = {
                            schemaVersion: SCHEMA_VERSION,
                            key: generateDeviceKeyB64(),
                            createdAt: Date.now()
                        };
                        await this.fs!.writeText(DEVICE_PATH, JSON.stringify(file));
                    }
                    return decodeKeyB64(file.key);
                } catch (e) {
                    warn("device key unavailable:", e instanceof Error ? e.message : e);
                    return null;
                }
            })();
        }
        return this.deviceKeyPromise;
    }

    // --- record io --------------------------------------------------------------

    private async readRecord(channelId: string): Promise<ArchiveRecord | null> {
        if (!this.fs) return null;
        try {
            if (!(await this.fs.exists(archivePath(channelId)))) return null;
            const raw = await this.fs.readJson(archivePath(channelId));
            return validateArchiveRecord(raw);
        } catch (e) {
            warn("archive record unreadable:", e instanceof Error ? e.message : e);
            return null;
        }
    }

    private async writeRecord(channelId: string, rec: ArchiveRecord): Promise<void> {
        await this.enqueue(this.fs, f => f.writeText(archivePath(channelId), JSON.stringify(rec)));
    }

    // --- creation / unlock --------------------------------------------------------

    async createArchive(
        channelId: string,
        userId: string | null,
        displayName: string | null,
        password: string
    ): Promise<void> {
        if (!this.fs) throw new Error("Local storage unavailable (native file module not found)");
        traceStep("ca:start");
        const existing = await this.readRecord(channelId);
        if (existing) throw new Error("Archive already exists");

        traceStep("ca:kdf-begin");
        const kdf = makeKdfParams();
        const { kek, ver } = deriveKeys(password, kdf);
        traceStep("ca:kdf-done");

        const masterKey = generateMasterKey();
        traceStep("ca:keygen-done");
        const devKey = await this.getDeviceKey();
        traceStep("ca:devkey-done");

        const rec: ArchiveRecord = {
            schemaVersion: SCHEMA_VERSION,
            channelId,
            userId,
            kdf,
            verifier: verifierTag(ver),
            wrap: {
                algo: "xchacha20poly1305",
                ct: wrapMasterKey(masterKey, kek, channelId)
            },
            devWrap: devKey
                ? ({
                      algo: "xchacha20poly1305",
                      ct: wrapMasterKey(masterKey, devKey, `dev/${channelId}`)
                  } satisfies SealedBlob)
                : null,
            data: sealJson(masterKey, channelId, { messages: [] } satisfies ArchiveDataPayload),
            count: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        traceStep("ca:write-record");
        await this.writeRecord(channelId, rec);
        traceStep("ca:write-record-done");
        this.sessionKeys.set(channelId, masterKey);
        await this.state.upsertConversationMeta(channelId, { userId, displayName });
        log("created archive for channel", channelId.slice(-4));
    }

    /**
     * Verify a password and unlock. Returns message count on success.
     * Throws "WRONG_PASSWORD" on bad password.
     */
    async unlockArchive(channelId: string, password: string): Promise<number> {
        const rec = await this.readRecord(channelId);
        if (!rec) throw new Error("NO_ARCHIVE");

        const { ver, kek } = deriveKeys(password, rec.kdf);
        if (!timingSafeEqualB64(verifierTag(ver), rec.verifier)) {
            dbg("unlock failed for", channelId.slice(-4));
            throw new Error("WRONG_PASSWORD");
        }
        const masterKey = unwrapMasterKey(rec.wrap.ct, kek, channelId);
        this.sessionKeys.set(channelId, masterKey);

        // sanity check the payload decrypts and matches state count
        const payload = openJson<ArchiveDataPayload>(masterKey, channelId, rec.data);
        await this.state.reconcileCount(channelId, payload.messages.length);
        return payload.messages.length;
    }

    /** Silent key acquisition for the hide path (device-key wrapped copy). */
    private async acquireMasterKeySilently(channelId: string): Promise<Uint8Array | null> {
        const cached = this.sessionKeys.get(channelId);
        if (cached) return cached;

        const rec = await this.readRecord(channelId);
        if (!rec?.devWrap) return null;

        const devKey = await this.getDeviceKey();
        if (!devKey) return null;

        try {
            const key = unwrapMasterKey(rec.devWrap.ct, devKey, `dev/${channelId}`);
            this.sessionKeys.set(channelId, key);
            return key;
        } catch (e) {
            warn("device-key unwrap failed:", e instanceof Error ? e.message : e);
            return null;
        }
    }

    lockArchive(channelId: string): void {
        this.sessionKeys.delete(channelId);
    }

    isUnlockedForWrite(channelId: string): boolean {
        return this.sessionKeys.has(channelId);
    }

    // --- content access -----------------------------------------------------------

    /** Requires prior unlock (password path). Returns decrypted snapshots. */
    async getArchivedMessages(channelId: string): Promise<ArchivedMessage[]> {
        const key = this.sessionKeys.get(channelId);
        if (!key) throw new Error("LOCKED");
        const rec = await this.readRecord(channelId);
        if (!rec) throw new Error("NO_ARCHIVE");
        const payload = openJson<ArchiveDataPayload>(key, channelId, rec.data);
        payload.messages.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
        return payload.messages;
    }

    /**
     * Append snapshots to the archive and register their ids in the filter.
     * Password-free by design (device-key envelope).
     */
    async hideMessages(
        channelId: string,
        snapshots: SnapshotInput[],
        meta?: { userId?: string | null; displayName?: string | null }
    ): Promise<{ hidden: number }> {
        if (!snapshots.length) return { hidden: 0 };

        const key = await this.acquireMasterKeySilently(channelId);
        if (!key) throw new Error("ARCHIVE_LOCKED_NO_DEVICE_KEY");

        const rec = await this.readRecord(channelId);
        if (!rec) throw new Error("NO_ARCHIVE");

        const payload = openJson<ArchiveDataPayload>(key, channelId, rec.data);
        const known = new Set(payload.messages.map(m => m.id));
        const fresh = snapshots.filter(s => !known.has(s.id));
        if (!fresh.length) return { hidden: 0 };

        const now = Date.now();
        for (const s of fresh) {
            payload.messages.push({
                id: String(s.id),
                channelId: String(s.channelId || channelId),
                authorId: String(s.authorId ?? "0"),
                authorName: String(s.authorName ?? "Unknown"),
                content: typeof s.content === "string" ? s.content : "",
                timestamp: String(s.timestamp ?? new Date().toISOString()),
                editedTimestamp: s.editedTimestamp ?? null,
                outgoing: Boolean(s.outgoing),
                type: typeof s.type === "number" ? s.type : 0,
                reply: s.reply ?? null,
                attachments: Array.isArray(s.attachments) ? s.attachments : [],
                embeds: Array.isArray(s.embeds) ? s.embeds : [],
                hiddenAt: now
            });
        }
        payload.messages.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

        // 1) archive first
        rec.data = sealJson(key, channelId, payload);
        rec.count = payload.messages.length;
        rec.updatedAt = now;
        await this.writeRecord(channelId, rec);

        traceStep("hm:write-record-done");
        // 2) then the filter/state
        await this.state.addHiddenIds(
            channelId,
            fresh.map(m => m.id),
            meta
        );

        dbg("hid", fresh.length, "messages in", channelId.slice(-4), "total", rec.count);
        return { hidden: fresh.length };
    }

    /**
     * Restore ids: unfilter immediately, then drop their snapshots.
     */
    async restoreMessages(channelId: string, ids: string[]): Promise<number> {
        if (!ids.length) return 0;
        const idSet = new Set(ids);

        // 1) unfilter first (worst case afterwards: orphan snapshot, still restorable)
        await this.state.removeHiddenIds(channelId, [...idSet]);

        const key = await this.acquireMasterKeySilently(channelId);
        const rec = await this.readRecord(channelId);
        if (!key || !rec) return ids.length;

        const payload = openJson<ArchiveDataPayload>(key, channelId, rec.data);
        const before = payload.messages.length;
        payload.messages = payload.messages.filter(m => !idSet.has(m.id));

        if (payload.messages.length !== before) {
            rec.data = sealJson(key, channelId, payload);
            rec.count = payload.messages.length;
            rec.updatedAt = Date.now();
            await this.writeRecord(channelId, rec);
            await this.state.reconcileCount(channelId, payload.messages.length);
        }
        dbg("restored", before - payload.messages.length, "in", channelId.slice(-4));
        return before - payload.messages.length;
    }

    /** Destroy everything LocalHide knows about one conversation. */
    async resetArchive(channelId: string): Promise<void> {
        // 1) remove filter + metadata from state/memory so chat returns instantly
        await this.state.forgetConversation(channelId);
        // 2) delete encrypted artifacts
        try {
            if (this.fs && (await this.fs.exists(archivePath(channelId)))) {
                await this.enqueue(this.fs, f => f.remove(archivePath(channelId)));
            }
        } catch (e) {
            warn("failed removing archive file:", e instanceof Error ? e.message : e);
        }
        this.sessionKeys.delete(channelId);
        log("reset archive for", channelId.slice(-4));
    }

    /** True when the archive can be appended to without user interaction. */
    async canHideWithoutPassword(channelId: string): Promise<boolean> {
        if (!this.hasArchive(channelId)) return false;
        if (this.isUnlockedForWrite(channelId)) return true;
        return (await this.acquireMasterKeySilently(channelId)) != null;
    }
}

export const archives = new ArchiveManager();