import { describe, it, expect, beforeEach } from "vitest";
import { StateStore } from "../src/storage/store";
import { ArchiveManager } from "../src/storage/archives";
import type { FsAdapter } from "../src/storage/fs";
import type { ArchivedMessage } from "../src/storage/schema";

/** In-memory FsAdapter standing in for Discord's native file module. */
class MemoryFs implements FsAdapter {
    files = new Map<string, string>();

    async readJson(path: string): Promise<unknown> {
        const raw = this.files.get(path);
        if (raw === undefined) throw new Error(`ENOENT ${path}`);
        return JSON.parse(raw);
    }
    async writeText(path: string, data: string): Promise<void> {
        this.files.set(path, data);
    }
    async remove(path: string): Promise<void> {
        this.files.delete(path);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }
}

const CH = "111111111111111111";

function makeSnapshot(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        channelId: CH,
        authorId: "222222222222222222",
        authorName: "Person B",
        content: `secret message ${id}`,
        timestamp: new Date(2026, 0, 1).toISOString(),
        editedTimestamp: null,
        outgoing: false,
        type: 0,
        reply: null,
        attachments: [],
        embeds: [],
        ...overrides
    };
}

let fs: MemoryFs;
let state: StateStore;
let archives: ArchiveManager;
const PASSWORD = "correct-horse-42";

beforeEach(async () => {
    fs = new MemoryFs();
    state = new StateStore(fs);
    archives = new ArchiveManager(fs, state);
    await state.load();
    archives.init();
});

describe("archive lifecycle + hide/restore consistency", () => {
    it("creates an archive and commits the pending hide", async () => {
        await archives.createArchive(CH, "222222222222222222", "Person B", PASSWORD);

        expect(archives.hasArchive(CH)).toBe(true);
        expect(fs.files.get("archive." + CH + ".json")).toBeDefined();

        const res = await archives.hideMessages(CH, [makeSnapshot("100")]);
        expect(res.hidden).toBe(1);
        expect(state.isHidden("100")).toBe(true);
        expect(await archives.getArchivedMessages(CH)).toHaveLength(1);
    });

    it("hides without a password after restart via the device-key envelope", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("101")]);

        // simulate full app restart: fresh fs view is same storage, but empty session keys
        const restartedArchives = new ArchiveManager(fs, state);
        restartedArchives.init();

        const res = await restartedArchives.hideMessages(CH, [makeSnapshot("102"), makeSnapshot("103")]);
        expect(res.hidden).toBe(2);
        expect(state.isHidden("102")).toBe(true);
        expect(state.isHidden("103")).toBe(true);
    });

    it("rejects wrong password on unlock without leaking validity of records", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);

        // a fresh manager (as after an app restart) has no cached session key
        const fresh = new ArchiveManager(fs, state);
        fresh.init();
        await expect(fresh.unlockArchive(CH, "wrong-password")).rejects.toThrow("WRONG_PASSWORD");
        // locked -> contents unavailable
        await expect(fresh.getArchivedMessages(CH)).rejects.toThrow("LOCKED");
    });

    it("unlocks with correct password and exposes decrypted messages", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("104", { content: "hello :3" })]);

        const count = await archives.unlockArchive(CH, PASSWORD);
        const msgs = await archives.getArchivedMessages(CH);
        expect(msgs.some(m => m.content === "hello :3")).toBe(true);
    });

    it("restore removes both filter entry and encrypted snapshot", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [
            makeSnapshot("201"),
            makeSnapshot("202"),
            makeSnapshot("203")
        ]);

        await archives.restoreMessages(CH, ["202"]);

        expect(state.isHidden("202")).toBe(false);
        expect(state.isHidden("201")).toBe(true);
        const msgs = await archives.getArchivedMessages(CH);
        expect(msgs.map(m => m.id)).toEqual(["201", "203"]);
    });

    it("bulk restore unfilters everything at once", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("301"), makeSnapshot("302"), makeSnapshot("303")]);

        await archives.restoreMessages(CH, ["301", "302", "303"]);
        expect(state.totals().messages).toBe(0);
        expect((await archives.getArchivedMessages(CH))).toHaveLength(0);
    });

    it("reset deletes archive artifacts and restores visibility", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("401")]);

        await archives.resetArchive(CH);

        expect(state.isHidden("401")).toBe(false);
        expect(archives.hasArchive(CH)).toBe(false);
        expect(fs.files.get("archive." + CH + ".json")).toBeUndefined();
        expect(await fs.exists("archive." + CH + ".json")).toBe(false);
    });

    it("dedupes repeated hides of the same message id", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("501")]);
        const again = await archives.hideMessages(CH, [makeSnapshot("501")]);
        expect(again.hidden).toBe(0);
        expect(await archives.getArchivedMessages(CH)).toHaveLength(1);
    });

    it("sorts archived messages chronologically regardless of insert order", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [
            makeSnapshot("602", { timestamp: "2026-03-01T00:00:00.000Z" }),
            makeSnapshot("601", { timestamp: "2026-01-01T00:00:00.000Z" }),
            makeSnapshot("603", { timestamp: "2026-05-01T00:00:00.000Z" })
        ]);
        const msgs = await archives.getArchivedMessages(CH);
        expect(msgs.map(m => m.timestamp.slice(0, 10))).toEqual(["2026-01-01", "2026-03-01", "2026-05-01"]);
    });

    it("keeps stored snapshots unreadable at rest", async () => {
        await archives.createArchive(CH, null, null, PASSWORD);
        await archives.hideMessages(CH, [makeSnapshot("701", { content: "TOPSECRET" })]);

        const rawFile = fs.files.get("archive." + CH + ".json")!;
        expect(rawFile).not.toContain("TOPSECRET");
        expect(rawFile).not.toContain(PASSWORD);
        expect(rawFile).toContain("\"ct\":");

        // device.json contains only opaque key material
        expect(fs.files.get("device.json")).not.toContain(PASSWORD);
    });
});
