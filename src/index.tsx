import { stateStore } from "./storage/store";
import { archives } from "./storage/archives";
import { patchActionSheet, unpatchActionSheet } from "./patches/actionSheet";
import { applyRenderPatches, removeRenderPatches } from "./patches/render";
import { patchProfilePanel, unpatchProfilePanel } from "./patches/profile";
import { selection } from "./state/selection";
import { loadPersistedTrace, traceStep } from "./storage/fs";
import { log, warn } from "./lib/logger";

/**
 * LocalHide - locally hide and protect messages in Discord DMs.
 *
 * Everything this plugin does happens on-device: no Discord API mutations,
 * no analytics, no networking beyond Kettu's own plugin fetch.
 *
 * Tested against: Discord iOS 305.1 (build 88876) + KettuTweak 2.0.0
 * (Bunny/Pyon plugin runtime).
 */

let started = false;

// Delay all feature work well past Discord's own boot sequence.
const BOOT_DELAY_MS = 12000;

export default {
    onLoad() {
        if (started) return;
        started = true;
        log("loaded (features deferred)");
        setTimeout(() => {
            void start();
        }, BOOT_DELAY_MS);
    },

    onUnload() {
        started = false;
        selection.exit();
        void archives.destroySessionKeys();
        unpatchActionSheet();
        removeRenderPatches();
        unpatchProfilePanel();
        log("LocalHide unloaded");
    }
};

async function start(): Promise<void> {
    await loadPersistedTrace().catch(() => {});
    traceStep("start");

    try {
        await stateStore.load();
        traceStep("state-loaded");
    } catch (e) {
        warn("state load failed:", e instanceof Error ? e.message : e);
    }

    try {
        archives.init();
        traceStep("archives-init");
    } catch (e) {
        warn("archive init failed:", e instanceof Error ? e.message : e);
    }

    // Each feature installs independently; a failure disables only itself.
    await Promise.allSettled([patchActionSheet(), applyRenderPatches(), patchProfilePanel()]);
    traceStep("features-done");
    log("features active");
}
