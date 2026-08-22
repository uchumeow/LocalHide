import { getModals, getRootNavModule, resolveWithRetry } from "./metro";
import { React } from "@vendetta/metro/common";
import { dbg } from "./logger";

/**
 * Full-screen navigation via Discord's lazy modal layer
 * (modules exposing pushLazy/popWithKey). Pattern verified against current
 * Kettu-compatible plugins (Discovery-style pushLazy modals).
 */

const usedKeys = new Set<string>();

export async function openScreen(
    Component: React.ComponentType<any>,
    props?: any,
    key = "LocalHideModal"
): Promise<boolean> {
    const modals = await resolveWithRetry(getModals, 10, 1000);
    if (!modals?.pushLazy) {
        dbg("pushLazy module unavailable");
        return false;
    }

    // guard against stacking duplicates of the same screen
    let finalKey = key;
    let n = 1;
    while (usedKeys.has(finalKey)) finalKey = `${key}~${++n}`;
    usedKeys.add(finalKey);

    const Screen = (p: any) => {
        return <Component {...p} {...props} modalKey={finalKey} />;
    };

    try {
        modals.pushLazy(Promise.resolve({ default: Screen }), finalKey);
        return true;
    } catch (e) {
        dbg("pushLazy failed:", e instanceof Error ? e.message : e);
        return false;
    }
}

/** Close the top-most pushed LocalHide screen via root stack goBack. */
export function closeTopScreen(): void {
    try {
        const ref = getRootNavModule()?.getRootNavigationRef?.();
        ref?.current?.goBack?.();
    } catch {}
}
