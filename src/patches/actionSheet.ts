import { before, after } from "@vendetta/patcher";
import { React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import {
    featureStatus,
    getActionSheetRow,
    getAssetIdSafe,
    getFormRow,
    getLazyActionSheet,
    resolveWithRetry
} from "../lib/metro";
import { getChannel, isOneToOneDm } from "../lib/snapshot";
import HideRows from "../components/HideRows";
import { dbg, log, warn } from "../lib/logger";

/**
 * Message long-press action sheet entries.
 *
 * Verified pattern for Discord 305.x / Kettu: ActionSheet.openLazy receives
 * (lazyComponentPromise, key, args) where key === "MessageLongPressActionSheet"
 * and args carries the pressed message. We wrap the lazily-resolved component
 * and inject LocalHide rows into the first ActionSheetRowGroup of the rendered
 * tree. The inner patch removes itself when the sheet unmounts.
 */

let unpatchOpenLazy: (() => void) | null = null;

function isDmEligible(message: any): boolean {
    const channelId = String(message?.channel_id ?? message?.channelId ?? "");
    if (!channelId || !message?.id) return false;
    return isOneToOneDm(getChannel(channelId));
}

export async function patchActionSheet(): Promise<void> {
    const LazyActionSheet = await resolveWithRetry(getLazyActionSheet, 20, 1500);
    if (!LazyActionSheet?.openLazy) {
        warn("ActionSheet module not found - hide actions unavailable");
        return;
    }

    unpatchOpenLazy = before("openLazy", LazyActionSheet as any, ([comp, key, msg]) => {
        if (key !== "MessageLongPressActionSheet" || !msg?.message) return;
        if (!comp?.then) return;

        const message = msg.message;
        if (!isDmEligible(message)) return;

        comp.then((instance: any) => {
            try {
                const unpatchInner = after("default", instance, (_args: unknown, tree: any) => {
                    // runs inside the sheet's render; hook into its lifecycle
                    React.useEffect(() => {
                        return () => {
                            unpatchInner();
                        };
                    }, []);
                    injectRows(tree, message);
                });
            } catch (e) {
                dbg("action sheet inner patch failed:", e instanceof Error ? e.message : e);
            }
        }).catch((e: unknown) => {
            dbg("lazy sheet resolve failed:", e instanceof Error ? e.message : e);
        });
    });

    featureStatus.actionSheet = true;
    log("action sheet patch installed");
}

export function unpatchActionSheet(): void {
    try {
        unpatchOpenLazy?.();
    } catch {}
    unpatchOpenLazy = null;
}

function injectRows(tree: any, message: any) {
    const ActionSheetRow = getActionSheetRow();
    const FormRow = getFormRow();
    if (!ActionSheetRow && !FormRow) {
        warn("no row component available for action sheet injection");
        return;
    }

    const iconHide = getAssetIdSafe([
        "ic_eye_closed_24px",
        "ic_eye_off_24px",
        "ic_hide_24px",
        "ic_message_hide_24px"
    ]);
    const iconSelect = getAssetIdSafe([
        "ic_select_manually_24px",
        "ic_checkmark_circle_unchecked_24px",
        "ic_checkbox_unchecked_24px",
        "ic_select_24px"
    ]);

    const rowsElement = React.createElement(HideRows, {
        message,
        ActionSheetRow,
        FormRow,
        iconHide,
        iconSelect
    });

    // Preferred: insert into the array containing real ActionSheetRow elements.
    const rowArray: any[] | undefined = findInReactTree(
        tree,
        (c: any) =>
            Array.isArray(c) &&
            c.some(
                (child: any) =>
                    child?.type === ActionSheetRow || child?.type?.name === "ActionSheetRow"
            )
    );

    if (Array.isArray(rowArray)) {
        rowArray.push(rowsElement);
        return;
    }

    // Fallback: first plausible array of labeled rows anywhere in the tree.
    const broadArray: any[] | undefined = findInReactTree(
        tree,
        (c: any) =>
            Array.isArray(c) &&
            c.length >= 2 &&
            c.filter((x: any) => x?.props && ("label" in x.props || x?.type?.name?.includes("Row"))).length >= 2
    );

    if (Array.isArray(broadArray)) {
        broadArray.push(rowsElement);
        return;
    }

    dbg("could not locate action row container; sheet left untouched");
}
