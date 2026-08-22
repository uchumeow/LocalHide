import { React } from "@vendetta/metro/common";
import { Text, View, Pressable, StyleSheet } from "react-native";
import { showToast } from "@vendetta/ui/toasts";
import { selection } from "../state/selection";
import { archives } from "../storage/archives";
import { buildSnapshot, getMessageById, getOtherUserId, getChannel } from "../lib/snapshot";
import { log } from "../lib/logger";

/**
 * Floating bulk-selection banner shown while LocalHide selection mode is
 * active. Reports the live selection count and offers Cancel / Hide.
 */
export default function SelectionBanner() {
    const [, force] = React.useReducer(n => ~n, 0);

    React.useEffect(() => selection.subscribe(force), []);

    const state = selection.get();
    if (!state.active) return null;

    const count = state.selected.size;

    const cancel = () => selection.exit();

    const confirm = async () => {
        const channelId = state.channelId;
        if (!channelId) return selection.exit();

        const ids = selection.takeSelected();
        selection.exit();

        // Build snapshots from Discord's message store; skip anything not cached.
        const snapshots = ids
            .map(id => getMessageById(channelId, id))
            .filter(Boolean)
            .map(m => buildSnapshot(m));

        try {
            const channel = getChannel(channelId);
            const meta = {
                userId: getOtherUserId(channel),
                displayName: null
            };
            const res = await archives.hideMessages(channelId, snapshots, meta);
            showToast(`Hidden ${res.hidden} message${res.hidden === 1 ? "" : "s"}`);
            log("bulk hid", res.hidden);
        } catch (e) {
            showToast("LocalHide failed to hide messages");
            log("bulk hide error:", e instanceof Error ? e.message : e);
        }
    };

    return (
        <View style={styles.wrap} pointerEvents="box-none">
            <View style={styles.card}>
                <Text style={styles.count}>{`${count} selected`}</Text>
                <View style={styles.actions}>
                    <Pressable onPress={cancel} hitSlop={8}>
                        <Text style={[styles.actionText, styles.cancel]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        disabled={count === 0}
                        onPress={() => void confirm()}
                        hitSlop={8}
                        style={({ pressed }: any) => [styles.confirmBtn, count === 0 && styles.disabled]}
                    >
                        <Text style={styles.confirmText}>{`Hide ${count} Message${count === 1 ? "" : "s"}`}</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 130,
        alignItems: "center"
    },
    card: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#111214",
        borderColor: "#5865F2",
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 16
    },
    count: { color: "#fff", fontWeight: "600", fontSize: 15, marginRight: 14 },
    actions: { flexDirection: "row", alignItems: "center" },
    cancel: { color: "#949ba4", marginRight: 14 },
    actionText: { fontSize: 15, fontWeight: "600" },
    confirmBtn: {
        backgroundColor: "#5865F2",
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 14
    },
    confirmText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    disabled: { opacity: 0.4 }
});
