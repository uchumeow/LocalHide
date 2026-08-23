import { before, after } from "@vendetta/patcher";
import { React } from "@vendetta/metro/common";
import { View, Pressable, StyleSheet } from "react-native";
import {
    featureStatus,
    flags,
    getChatView,
    getMessageWithContent,
    getRowGenerator,
    locateGenerateTarget,
    resolveWithRetry
} from "../lib/metro";
import { stateStore } from "../storage/store";
import { selection } from "../state/selection";
import SelectionBanner from "../components/SelectionBanner";
import { dbg, log, warn } from "../lib/logger";

/**
 * Render-layer message filtering.
 *
 * Target: Discord's RowGenerator (modules/messages/native/renderer/
 * RowGenerator.tsx in 305.x) - the component that turns messages into
 * virtualized rows for the chat list. Patching here never touches
 * MessageStore, pagination or cached objects; it only affects what the
 * renderer receives.
 *
 * Because Discord reshapes internals between builds, three defensive layers:
 *   1. generate() input filter  (array input, or single descriptor input)
 *   2. generate() output filter (strip rows referencing hidden messages)
 *   3. MessageWithContent render backstop (null-render hidden messages)
 * Layer engagement is recorded for diagnostics.
 */

const unpatchers: Array<() => void> = [];
let filterStats = { input: 0, output: 0, backstop: 0 };

/**
 * RowGenerator.generate array surgery is OFF by default: mutating Discord's
 * managed row arrays destabilizes list virtualization on some builds
 * (random native crashes). Hiding relies on the MessageWithContent render
 * backstop instead, which never touches list data.
 */
const ENABLE_ROW_GENERATOR_FILTER = false;

export function getFilterStats() {
    return { ...filterStats };
}

function isHidden(messageId: unknown): boolean {
    return typeof messageId === "string" && stateStore.isHidden(messageId);
}

/** Extract a message id from an arbitrary row/descriptor shape. */
function messageIdOf(item: any): string | null {
    const id = item?.message?.id ?? item?.messageId ?? item?.id;
    return typeof id === "string" ? id : null;
}

async function patchRowGenerator(): Promise<void> {
    if (!ENABLE_ROW_GENERATOR_FILTER) {
        featureStatus.rowFilter = false;
        return;
    }
    const mod = await resolveWithRetry(getRowGenerator, 20, 1500);
    if (!mod) {
        warn("RowGenerator not found - relying on render backstop only");
        return;
    }
    const target = locateGenerateTarget(mod);
    if (!target) {
        warn("RowGenerator.generate not found - relying on render backstop only");
        return;
    }

    unpatchers.push(
        before("generate", target as any, (args: any[]) => {
            if (!stateStore || !args.length) return;
            try {
                const first = args[0];

                // Shape A: array of messages
                if (Array.isArray(first)) {
                    if (first.length && first.some(m => isHidden(messageIdOf(m)))) {
                        args[0] = first.filter((m: any) => !isHidden(messageIdOf(m)));
                        filterStats.input++;
                        dbg("filtered message from generate() input");
                    }
                    return;
                }

                // Shape B: single chat item descriptor with .message
                const id = messageIdOf(first);
                if (first?.message && id && isHidden(id)) {
                    filterStats.input++;
                    dbg("suppressed single generate() item");
                    return [[]];
                }
            } catch (e) {
                dbg("input filter error:", e instanceof Error ? e.message : e);
            }
        })
    );

    unpatchers.push(
        after("generate", target as any, (_args: unknown[], result: any) => {
            try {
                if (!Array.isArray(result)) return result;
                let changed = false;
                const filtered = result.filter((row: any) => {
                    const id = messageIdOf(row);
                    const drop = id != null && isHidden(id);
                    if (drop) changed = true;
                    return !drop;
                });
                if (changed) {
                    filterStats.output++;
                    dbg("stripped hidden rows from generate() output");
                    return filtered;
                }
            } catch (e) {
                dbg("output filter error:", e instanceof Error ? e.message : e);
            }
            return result;
        })
    );

    featureStatus.rowFilter = true;
    log("RowGenerator filter installed");
}

/**
 * Backstop + bulk-selection interaction on the per-message component.
 * When selection mode is active for this channel, messages are wrapped in a
 * tappable overlay; otherwise the wrapper is skipped entirely.
 */
async function patchMessageWithContent(): Promise<void> {
    const mod = await resolveWithRetry(getMessageWithContent, 20, 1500);
    if (!mod) {
        warn("MessageWithContent not found - selection mode unavailable");
        return;
    }
    const target = typeof mod === "function" ? mod : mod.default ?? mod.MessageWithContent;
    if (typeof target !== "function") {
        warn("MessageWithContent target invalid - selection mode unavailable");
        return;
    }

    unpatchers.push(
        after("default", target as any, ([props]: any[], rendered: any) => {
            try {
                const message = props?.message;
                const channelId = String(message?.channel_id ?? message?.channelId ?? "");
                const messageId = message ? String(message.id) : null;

                // backstop: hidden messages must never render
                if (messageId && stateStore.isHidden(messageId)) {
                    filterStats.backstop++;
                    return null;
                }

                // selection mode tap interception + visual state
                if (messageId && selection.isActiveFor(channelId)) {
                    return React.createElement(SelectableMessageWrapper, {
                        messageId,
                        children: rendered
                    });
                }
            } catch {
                // never break Discord's render pass
            }
            return rendered;
        })
    );

    log("MessageWithContent patch installed");
}

function SelectableMessageWrapper({ messageId, children }: { messageId: string; children: any }) {
    const [, force] = React.useReducer(n => ~n, 0);

    React.useEffect(() => {
        return selection.subscribe(force);
    }, []);

    const selected = selection.isSelected(messageId);

    return (
        <View style={selected ? styles.selected : styles.unselected}>
            <Pressable
                style={styles.pressable}
                onPress={() => selection.toggle(messageId)}
                accessibilityLabel={selected ? "Deselect message" : "Select message"}
            >
                {selected ? <View style={styles.tint} /> : null}
                {children}
            </Pressable>
            {selected ? <View style={styles.badge} pointerEvents="none" /> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    pressable: {
        width: "100%"
    },
    selected: {
        borderRadius: 8,
        borderWidth: 2,
        borderColor: "#5865F2",
        overflow: "hidden"
    },
    unselected: {
        borderRadius: 8,
        borderWidth: 2,
        borderColor: "transparent"
    },
    tint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "#5865F229"
    },
    badge: {
        position: "absolute",
        top: 6,
        right: 8,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: "#5865F2",
        borderWidth: 2,
        borderColor: "#FFFFFF"
    }
});

async function patchChatViewBanner(): Promise<void> {
    const mod = await resolveWithRetry(getChatView, 20, 1500);
    if (!mod) {
        dbg("ChatView not found - selection banner unavailable");
        return;
    }
    const target = typeof mod === "function" ? mod : mod.default;
    if (typeof target !== "function") return;

    unpatchers.push(
        after("default", target as any, (_args: unknown[], rendered: any) => {
            try {
                if (!selection.get().active) return rendered;
                return React.createElement(
                    React.Fragment,
                    null,
                    rendered,
                    React.createElement(SelectionBanner, null)
                );
            } catch {
                return rendered;
            }
        })
    );
    featureStatus.selectionBanner = true;
}

async function applyRenderPatchesInner(): Promise<void> {
    const jobs: Promise<void>[] = [];
    if (flags.messageBackstop || flags.chatBanner) jobs.push(patchMessageWithContent());
    if (flags.rowGeneratorFilter) jobs.push(patchRowGenerator());
    if (flags.chatBanner) jobs.push(patchChatViewBanner());
    await Promise.allSettled(jobs);
}

export async function applyRenderPatches(): Promise<void> {
    if (!flags.messageBackstop && !flags.rowGeneratorFilter && !flags.chatBanner) {
        dbg("render patches disabled by flags");
        return;
    }
    await applyRenderPatchesInner();
}

export function removeRenderPatches(): void {
    for (const up of unpatchers.splice(0)) {
        try {
            up();
        } catch {}
    }
}
