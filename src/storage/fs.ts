/**
 * Minimal typed surface over the native Discord file module, mirroring how
 * Bunny/Kettu's own file backend resolves it (turbo module proxy or the
 * legacy nativeModuleProxy). Kept local so LocalHide does not depend on
 * bunny-only APIs.
 */

type AnyRecord = Record<string, any>;

function resolveFileModule(): any {
    const g = globalThis as AnyRecord;
    // Prefer the classic proxy modules (battle-tested on iOS by Bunny-era
    // plugins); fall back to turbo interop.
    const PROXY_NAMES = ["DCDFileManager", "RTNFileManager", "NativeFileModule"];
    const nmp = g.nativeModuleProxy;
    if (nmp) {
        for (const name of PROXY_NAMES) {
            const m = nmp[name];
            if (m && typeof m.writeFile === "function" && typeof m.readFile === "function") {
                return m;
            }
        }
    }
    try {
        if (g.__turboModuleProxy) {
            for (const name of PROXY_NAMES) {
                const m = g.__turboModuleProxy(name);
                if (m) return m;
            }
        }
    } catch {}
    return null;
}

// --- crash-survivable step trace -------------------------------------------

const traceLines: string[] = [];
let traceSeq = 0;

/**
 * Record a named step with timestamp. Kept in memory AND flushed to
 * localhide/trace.log (best-effort) so a hard crash leaves evidence of the
 * last completed step. Never log contents - step ids only.
 */
export function traceStep(step: string): void {
    traceSeq++;
    const line = `${Date.now()} #${traceSeq} ${step}`;
    traceLines.push(line);
    if (traceLines.length > 120) traceLines.shift();
    try {
        const mod = resolveFileModule();
        if (!mod || typeof mod.writeFile !== "function") return;
        let dir = "";
        try {
            dir = mod.getConstants().DocumentsDirPath;
        } catch {}
        const base = dir ? `${dir}/localhide` : "localhide";
        void Promise.resolve(mod.writeFile("documents", `${base}/trace.log`, traceLines.join("\n"), "utf8")).catch(
            () => {}
        );
    } catch {}
}

export function getTrace(): string[] {
    return [...traceLines];
}

const DIR = "localhide";

export interface FsAdapter {
    readJson(path: string): Promise<unknown>;
    writeText(path: string, data: string): Promise<void>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}

/** Diagnostics only: which native module backed the adapter, if any. */
let resolvedModuleName: string | null = null;
export function getFilesystemModuleName(): string | null {
    return resolvedModuleName;
}

export function createFsAdapter(): FsAdapter | null {
    const mod = resolveFileModule();
    if (!mod || typeof mod.writeFile !== "function" || typeof mod.readFile !== "function") return null;
    resolvedModuleName = (() => {
        const nmp = (globalThis as AnyRecord).nativeModuleProxy ?? {};
        for (const name of ["DCDFileManager", "RTNFileManager", "NativeFileModule"]) {
            if (nmp[name] === mod) return `proxy:${name}`;
        }
        return "turbo-module";
    })();

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
