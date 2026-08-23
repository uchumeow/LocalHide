import { before, after } from "@vendetta/patcher";
import { React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import {
    featureStatus,
    flags,
    getActionSheetRow,
    getAssetIdSafe,
    getFormRow,
    getLazyActionSheet,
    isMessageSheetKey,
    resolveWithRetry,
    findByFilePathRaw
} from "../lib/metro";
import { getChannel, isOneToOneDm } from "../lib/snapshot";
import { traceStep } from "../storage/fs";
import HideRows from "../components/HideRows";
import { dbg, log, warn } from "../lib/logger";

/**
 * Message long-press action sheet entries.
 *
 * Three strategies, all defensive:
 *   A. Direct patch of modules/messages/native/long_press/
 *      LongPressMessageActionSheet.tsx (305.x location).
 *   B. Legacy ActionSheet.openLazy hook with resilient key matching
 *      ("LongPressMessageActionSheet", older "MessageLongPressActionSheet").
 * The openLazy observer also records every sheet key seen (trace.log).
 */

const unpatchers: Array<() => void> = [];

function isDmEligible(message: any): boolean {
    const channelId = String(message?.channel_id ?? message?.channelId ?? "");
    if (!channelId || !message?.id) return false;
    try {
        return isOneToOneDm(getChannel(channelId));
    } catch {
        return false;
    }
}

function extractMessage(...candidates: any[]): any {
    for (const c of candidates) {
        const m = c?.message ?? c?.msg?.message ?? c?.msg;
        if (m?.id) return m;
    }
    return null;
}

/** Inject LocalHide rows once per render pass; returns true when placed. */
function injectRows(tree: any, message: any): boolean {
    const ActionSheetRow = getActionSheetRow();
    const FormRow = getFormRow();
    if (!ActionSheetRow && !FormRow) return false;

    // already injected this pass?
    const existing = findInReactTree(
        tree,
        (c: any) => Array.isArray(c) && c.some((x: any) => x?.props?.label === "Hide Locally")
    );
    if (Array.isArray(existing)) return true;

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
        iconSelect,
        selectionAvailable: featureStatus.selectionBanner
    });

    const rowArray: any[] | undefined = findInReactTree(
        tree,
        (c: any) =>
            Array.isArray(c) &&
            c.some((child: any) => child?.type === ActionSheetRow || child?.type?.name === "ActionSheetRow")
    );
    if (Array.isArray(rowArray)) {
        rowArray.push(rowsElement);
        return true;
    }

    const broadArray: any[] | undefined = findInReactTree(
        tree,
        (c: any) =>
            Array.isArray(c) &&
            c.length >= 2 &&
            c.filter((x: any) => x?.props && ("label" in x.props || x?.type?.name?.includes("Row"))).length >= 2
    );
    if (Array.isArray(broadArray)) {
        broadArray.push(rowsElement);
        return true;
    }
    return false;
}

export async function patchActionSheet(): Promise<void> {
    const jobs: Array<Promise<void>> = [];

    // --- Strategy A: direct component patch ---------------------------------
    jobs.push(
        resolveWithRetry(
            () => findByFilePathRaw("modules/messages/native/long_press/LongPressMessageActionSheet.tsx"),
            40,
            3000
        ).then(mod => {
            if (!mod) return dbg("A: direct sheet module not found");
            const target = typeof mod === "function" ? mod : mod.default;
            if (typeof target !== "function") return dbg("A: direct sheet target invalid");

            unpatchers.push(
                after("default", target as any, ([props]: any[], tree: any) => {
                    try {
                        const message = extractMessage(props, props?.route?.params);
                        if (!message || !isDmEligible(message)) return;
                        const ok = injectRows(tree, message);
                        if (ok) traceStep("inject:A");
                        else traceStep("inject:A-miss");
                    } catch (e) {
                        dbg("A injection error:", e instanceof Error ? e.message : e);
                    }
                })
            );
            log("sheet strategy A installed");
            featureStatus.actionSheet = true;
        })
    );

    // --- Strategy B/C: openLazy hook + observer ------------------------------
    jobs.push(
        resolveWithRetry(getLazyActionSheet, 20, 1500).then(LazyActionSheet => {
            if (!LazyActionSheet?.openLazy) {
                warn("openLazy module not found");
                return;
            }
            unpatchers.push(
                before("openLazy", LazyActionSheet as any, ([comp, key, msg]) => {
                    if (typeof key === "string") traceStep(`sheet:${key}`);
                    if (!flags.injectActionRows) return;
                    if (!isMessageSheetKey(key) || !msg?.message) return;
                    if (!comp?.then) return;

                    const message = msg.message;
                    if (!isDmEligible(message)) return;

                    comp.then((instance: any) => {
                        try {
                            const unpatchInner = after("default", instance, (_args: unknown, tree: any) => {
                                React.useEffect(() => {
                                    return () => {
                                        unpatchInner();
                                    };
                                }, []);
                                try {
                                    const ok = injectRows(tree, message);
                                    if (ok) traceStep("inject:C");
                                } catch (e) {
                                    dbg("C injection error:", e instanceof Error ? e.message : e);
                                }
                            });
                        } catch (e) {
                            dbg("inner patch failed:", e instanceof Error ? e.message : e);
                        }
                    }).catch((e: unknown) => {
                        dbg("lazy sheet resolve failed:", e instanceof Error ? e.message : e);
                    });
                })
            );
            log("sheet strategy B/C installed");
        })
    );

    await Promise.allSettled(jobs);
}

export function unpatchActionSheet(): void {
    for (const up of unpatchers.splice(0)) {
        try {
            up();
        } catch {}
    }
}
