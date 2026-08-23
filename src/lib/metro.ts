import { findByProps, findByName, findByStoreName, findByDisplayName } from "@vendetta/metro";
import { getAssetIDByName } from "@vendetta/ui/assets";

/**
 * Centralized Discord/Kettu module lookups.
 *
 * Every Discord-internal lookup in LocalHide lives in this file. When Discord
 * updates and something breaks, fix it here. Lookups are resilient:
 *   1. stable props/display names first
 *   2. Kettu's `__filePath` module annotations (survive numeric id changes)
 *   3. bounded retries for lazily-initialized modules
 *
 * Nothing in here may throw; callers receive null and degrade gracefully.
 */

type AnyRecord = Record<string, any>;

/**
 * Feature switches for safe bisection. Everything defaults off except the
 * action-sheet observer; re-enable one at a time once stability is confirmed.
 */
export const flags = {
    observeActionSheets: true,
    injectActionRows: true,
    messageBackstop: true,
    chatBanner: false,
    profilePanel: false,
    rowGeneratorFilter: false
};

export const featureStatus = {
    actionSheet: false,
    rowFilter: false,
    profilePanel: false,
    selectionBanner: false,
    navigation: false
} as Record<string, boolean>;

function modulesRegistry(): AnyRecord | null {
    try {
        return (globalThis as AnyRecord).modules ?? null;
    } catch {
        return null;
    }
}

/** Scan Kettu's module registry for a module annotated with the given source path. */
export function findByFilePathRaw(path: string): any {
    const mods = modulesRegistry();
    if (!mods) return null;
    try {
        for (const id in mods) {
            const m = mods[id];
            if (m && m.__filePath === path) return m;
        }
    } catch {
        // registry can be mutated during iteration; treat as not found this pass
    }
    return null;
}

export function resolveWithRetry<T>(fn: () => T, tries = 20, delayMs = 1500): Promise<T | null> {
    return new Promise(resolve => {
        let n = 0;
        const tick = () => {
            let out: T | undefined;
            let threw = false;
            try {
                out = fn();
            } catch {
                threw = true;
            }
            if (!threw && out != null) return resolve(out);
            if (++n >= tries) return resolve(null);
            setTimeout(tick, delayMs);
        };
        tick();
    });
}

// --- Generic shared modules -------------------------------------------------

export const getLazyActionSheet = () => findByProps("openLazy", "hideActionSheet") as AnyRecord | undefined;

export const getModals = () => findByProps("pushLazy", "popWithKey") as AnyRecord | undefined;

export const getRootNavModule = () => findByProps("getRootNavigationRef") as AnyRecord | undefined;

export const getChannelStore = () => findByStoreName("ChannelStore") as AnyRecord | undefined;

export const getUserStore = () => findByStoreName("UserStore") as AnyRecord | undefined;

/** Non-throwing store lookup (some stores may not be initialized yet). */
export function findByStoreNameSafe(name: string): AnyRecord | undefined {
    try {
        return findByStoreName(name) as AnyRecord | undefined;
    } catch {
        return undefined;
    }
}

export function getActionSheetRow(): any {
    const mod = findByProps("ActionSheetRow");
    if (mod?.ActionSheetRow) return mod.ActionSheetRow;
    return findByName("ActionSheetRow", false) ?? null;
}

export function getFormRow(): any {
    const mod = findByProps("FormRow");
    if (mod?.FormRow) return mod.FormRow;
    return null;
}

export function getAssetIdSafe(names: string[]): number | undefined {
    for (const name of names) {
        try {
            const id = getAssetIDByName(name);
            if (typeof id === "number" && id > 0) return id;
        } catch {
            // unknown asset name
        }
    }
    return undefined;
}

// --- Feature-specific components --------------------------------------------

export function getUserProfileSection(): any {
    const byPath = findByFilePathRaw("modules/user_profile/native/UserProfileSection.tsx");
    if (byPath) return byPath;
    return (
        findByName("UserProfileSection", false) ??
        findByName("UserProfileSection", true) ??
        findByDisplayNameSafe("UserProfileSection") ??
        null
    );
}

function findByDisplayNameSafe(name: string): any {
    try {
        return findByDisplayName(name, false) ?? findByDisplayName(name, true) ?? null;
    } catch {
        return null;
    }
}

export function getRowGenerator(): any {
    // File path ONLY - loose name/props matching has hit sibling modules
    // (e.g. GuildDirectoryRowGenerator) on real builds.
    return findByFilePathRaw("modules/messages/native/renderer/RowGenerator.tsx") ?? null;
}

/** The long-press sheet key changed across Discord versions; match resiliently. */
export function isMessageSheetKey(key: unknown): boolean {
    if (typeof key !== "string") return false;
    const normalized = key.toLowerCase();
    return normalized === "messagelongpressactionsheet" || normalized === "longpressmessageactionsheet";
}

export function getChatView(): any {
    const byPath =
        findByFilePathRaw("modules/chat/native/ChatView.tsx") ??
        findByFilePathRaw("modules/chat/native/Chat.ios.tsx");
    if (byPath) return byPath;
    return findByName("ChatView", false) ?? null;
}

export function getMessageWithContent(): any {
    return findByFilePathRaw("modules/messages/native/renderer/MessageWithContent.tsx")
        ?? findByName("MessageWithContent", false)
        ?? null;
}

/**
 * Given a located RowGenerator-ish module, find the patchable object holding
 * `generate` (class prototype or plain object).
 */
export function locateGenerateTarget(mod: any): AnyRecord | null {
    if (!mod) return null;
    const candidates = [mod, mod.default, mod.RowGenerator];
    for (const c of candidates) {
        if (!c) continue;
        if (typeof c.generate === "function") return c;
        if (c.prototype && typeof c.prototype.generate === "function") return c.prototype;
    }
    return null;
}
