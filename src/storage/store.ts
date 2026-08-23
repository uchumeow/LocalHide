import { emptyState, SCHEMA_VERSION, STATE_PATH, type StateData } from "./schema";
import { migrateState } from "./migrate";
import { createFsAdapter, writeQueue, type FsAdapter } from "./fs";
import { log, warn, dbg } from "../lib/logger";

/**
 * Plaintext state/index store. Holds conversation metadata and hidden message
 * ids for fast filtering. Never contains readable message content.
 *
 * All mutations are serialized through a write queue; every mutation updates
 * memory immediately and persists the whole state file asynchronously.
 */

type Listener = () => void;

export class StateStore {
    private fs: FsAdapter | null;
    private enqueue: ReturnType<typeof writeQueue>;
    private data: StateData;
    private loaded: boolean;

    // O(1) lookups for rendering
    readonly hiddenGlobal: Set<string>;
    private perChannel: Map<string, Set<string>>;

    private listeners: Set<Listener>;

    constructor(fs?: FsAdapter | null) {
        // NOTE: all instance state is assigned here explicitly; class field
        // initializers are unreliable under the plugin build's class transform
        this.fs = fs === undefined ? createFsAdapter() : fs;
        this.enqueue = writeQueue();
        this.data = emptyState();
        this.loaded = false;
        this.hiddenGlobal = new Set<string>();
        this.perChannel = new Map<string, Set<string>>();
        this.listeners = new Set<Listener>();
    }

    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            if (this.fs && (await this.fs.exists(STATE_PATH))) {
                const raw = await this.fs.readJson(STATE_PATH);
                this.data = migrateState(raw);
            } else {
                this.data = emptyState();
                await this.persist();
            }
            this.rebuildMemory();
        } catch (e) {
            warn("state.json failed to load/validate:", e instanceof Error ? e.message : e);
            log("starting with fresh state (previous state file kept untouched)");
            this.data = emptyState();
        }
        this.loaded = true;
    }

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        for (const fn of [...this.listeners]) {
            try {
                fn();
            } catch {}
        }
    }

    private rebuildMemory() {
        this.hiddenGlobal.clear();
        this.perChannel.clear();
        for (const [channelId, ids] of Object.entries(this.data.hiddenIds)) {
            const set = new Set(ids);
            this.perChannel.set(channelId, set);
            for (const id of ids) this.hiddenGlobal.add(id);
        }
    }

    private async persist(): Promise<void> {
        try {
            await this.enqueue(this.fs, async f => f.writeText(STATE_PATH, JSON.stringify(this.data)));
        } catch (e) {
            warn("failed to persist state.json:", e instanceof Error ? e.message : e);
        }
    }

    get version() {
        return this.data.schemaVersion;
    }

    isHidden(messageId: string): boolean {
        return this.hiddenGlobal.has(messageId);
    }

    getHiddenIdsForChannel(channelId: string): string[] {
        return [...(this.perChannel.get(channelId) ?? [])];
    }

    getConversation(channelId: string) {
        return this.data.conversations[channelId] ?? null;
    }

    /** userId -> channelId map (first wins) */
    getUserIdIndex(): Map<string, string> {
        const map = new Map<string, string>();
        for (const [channelId, conv] of Object.entries(this.data.conversations)) {
            if (conv.userId && !map.has(conv.userId)) map.set(conv.userId, channelId);
        }
        return map;
    }

    listConversations(): Array<{ channelId: string } & StateData["conversations"][string]> {
        return Object.entries(this.data.conversations).map(([channelId, c]) => ({ channelId, ...c }));
    }

    totals(): { conversations: number; messages: number } {
        let messages = 0;
        for (const c of Object.values(this.data.conversations)) messages += Math.max(c.count, 0);
        return { conversations: Object.keys(this.data.conversations).length, messages };
    }

    async addHiddenIds(
        channelId: string,
        ids: string[],
        meta?: { userId?: string | null; displayName?: string | null }
    ): Promise<void> {
        const clean = [...new Set(ids)].filter(id => typeof id === "string");
        if (!clean.length) return;

        const set = this.perChannel.get(channelId) ?? new Set<string>();
        let added = 0;
        for (const id of clean) {
            if (!set.has(id)) {
                set.add(id);
                this.hiddenGlobal.add(id);
                added++;
            }
        }
        this.perChannel.set(channelId, set);
        this.data.hiddenIds[channelId] = [...set];

        const now = Date.now();
        const conv =
            this.data.conversations[channelId] ??
            (this.data.conversations[channelId] = {
                userId: null,
                displayName: null,
                count: 0,
                createdAt: now,
                updatedAt: now
            });
        if (meta?.userId !== undefined) conv.userId = meta.userId;
        if (meta?.displayName !== undefined) conv.displayName = meta.displayName;
        conv.count += added;
        conv.updatedAt = now;

        await this.persist();
        this.emit();
    }

    async removeHiddenIds(channelId: string, ids: string[]): Promise<void> {
        const set = this.perChannel.get(channelId);
        const conv = this.data.conversations[channelId];
        if (!set && !conv) return;

        let removed = 0;
        for (const id of ids) {
            if (set?.delete(id)) {
                this.hiddenGlobal.delete(id);
                removed++;
            }
        }
        if (conv) {
            conv.count = Math.max((conv.count ?? 0) - removed, 0);
            conv.updatedAt = Date.now();
        }
        if (removed > 0 || set) {
            if (set?.size) this.data.hiddenIds[channelId] = [...set];
            else delete this.data.hiddenIds[channelId];
        }

        await this.persist();
        this.emit();
    }

    async upsertConversationMeta(
        channelId: string,
        meta: { userId?: string | null; displayName?: string | null }
    ): Promise<void> {
        const now = Date.now();
        const conv =
            this.data.conversations[channelId] ??
            (this.data.conversations[channelId] = {
                userId: null,
                displayName: null,
                count: 0,
                createdAt: now,
                updatedAt: now
            });
        if (meta.userId !== undefined) conv.userId = meta.userId;
        if (meta.displayName !== undefined) conv.displayName = meta.displayName;
        conv.updatedAt = now;
        await this.persist();
    }

    async forgetConversation(channelId: string): Promise<void> {
        const set = this.perChannel.get(channelId);
        if (set) {
            for (const id of set) this.hiddenGlobal.delete(id);
        }
        this.perChannel.delete(channelId);
        delete this.data.hiddenIds[channelId];
        delete this.data.conversations[channelId];
        dbg("forgot conversation", channelId.slice(-4));
        await this.persist();
        this.emit();
    }

    /** Recompute a conversation's count against authoritative source (archive). */
    async reconcileCount(channelId: string, actualCount: number): Promise<void> {
        const conv = this.data.conversations[channelId];
        if (!conv || conv.count === actualCount) return;
        conv.count = actualCount;
        conv.updatedAt = Date.now();
        await this.persist();
        this.emit();
    }
}

export const stateStore = new StateStore();