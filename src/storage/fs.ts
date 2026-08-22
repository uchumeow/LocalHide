/**
 * Minimal typed surface over the native Discord file module, mirroring how
 * Bunny/Kettu's own file backend resolves it (turbo module proxy or the
 * legacy nativeModuleProxy). Kept local so LocalHide does not depend on
 * bunny-only APIs.
 */

type AnyRecord = Record<string, any>;

function resolveFileModule(): any {
    const g = globalThis as AnyRecord;
    try {
        if (g.__turboModuleProxy) {
            for (const name of ["RTNFileManager", "DCDFileManager", "NativeFileModule"]) {
                const m = g.__turboModuleProxy(name);
                if (m) return m;
            }
        }
    } catch {}
    const nmp = g.nativeModuleProxy;
    if (nmp) {
        for (const name of ["RTNFileManager", "DCDFileManager", "NativeFileModule"]) {
            if (nmp[name]) return nmp[name];
        }
    }
    return null;
}

const DIR = "localhide";

export interface FsAdapter {
    readJson(path: string): Promise<unknown>;
    writeText(path: string, data: string): Promise<void>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}

export function createFsAdapter(): FsAdapter | null {
    const mod = resolveFileModule();
    if (!mod || typeof mod.writeFile !== "function" || typeof mod.readFile !== "function") return null;

    let documentsDir: string | undefined;
    try {
        documentsDir = mod.getConstants().DocumentsDirPath;
    } catch {
        documentsDir = undefined;
    }

    const abs = (path: string) =>
        documentsDir ? `${documentsDir}/${DIR}/${path}` : `${DIR}/${path}`;

    return {
        async readJson(path: string): Promise<unknown> {
            const content: string = await mod.readFile("documents", abs(path), "utf8");
            return JSON.parse(content);
        },
        async writeText(path: string, data: string): Promise<void> {
            await mod.writeFile("documents", abs(path), data, "utf8");
        },
        async remove(path: string): Promise<void> {
            if (typeof mod.removeFile === "function") {
                await mod.removeFile("documents", abs(path));
            }
        },
        async exists(path: string): Promise<boolean> {
            if (typeof mod.fileExists !== "function") return false;
            return await mod.fileExists(abs(path));
        }
    };
}

/**
 * Serialize all storage mutations through one queue so a failed write can
 * never interleave with another one. Each enqueued job receives the adapter;
 * jobs are skipped entirely when no adapter is available.
 */
export function writeQueue() {
    let tail: Promise<unknown> = Promise.resolve();
    return function enqueue<R>(fs: FsAdapter | null, job: (fs: FsAdapter) => Promise<R>): Promise<R> {
        const run = async () => {
            if (!fs) throw new Error("LocalHide: filesystem unavailable");
            return await job(fs);
        };
        const next = tail.then(run, run);
        tail = next.catch(() => undefined);
        return next;
    };
}
