import { React } from "@vendetta/metro/common";
import { FlatList, Text, View, Pressable, StyleSheet, Image } from "react-native";
import { stateStore } from "../storage/store";
import { archives } from "../storage/archives";
import { getUserStore } from "../lib/metro";
import { openScreen } from "../lib/modal";
import UnlockScreen from "./Unlock";
import { closeTopScreen } from "../lib/modal";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { showToast } from "@vendetta/ui/toasts";

/**
 * "Manage Protected Conversations": lists every conversation with a LocalHide
 * archive using display name + avatar where available. IDs are used
 * internally; names are display-only.
 */
export default function ManageConversations() {
    const [, force] = React.useReducer(n => ~n, 0);

    const conversations = React.useMemo(() => stateStore.listConversations(), []);

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <Pressable onPress={() => closeTopScreen()} hitSlop={8}>
                    <Text style={styles.back}>‹ Back</Text>
                </Pressable>
                <Text style={styles.title}>Protected Conversations</Text>
                <View style={{ width: 40 }} />
            </View>

            {conversations.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={{ color: "#949ba4" }}>No protected conversations yet.</Text>
                </View>
            ) : (
                <FlatList
                    data={conversations}
                    keyExtractor={(c: any) => c.channelId}
                    renderItem={({ item }: any) => (
                        <ConversationRow
                            conv={item}
                            onChanged={() => {
                                force();
                            }}
                        />
                    )}
                />
            )}
        </View>
    );
}

function ConversationRow({ conv, onChanged }: { conv: any; onChanged: () => void }) {
    const user = React.useMemo(() => {
        try {
            return conv.userId ? getUserStore()?.getUser?.(conv.userId) ?? null : null;
        } catch {
            return null;
        }
    }, [conv.userId]);

    const name = user?.globalName ?? user?.username ?? conv.displayName ?? `Unknown (${conv.channelId.slice(-6)})`;
    const avatarUri = React.useMemo(() => {
        if (user?.avatar && conv.userId) {
            return { uri: `https://cdn.discordapp.com/avatars/${conv.userId}/${user.avatar}.png?size=64` };
        }
        return null;
    }, [user?.avatar, conv.userId]);

    const open = () => void openScreen(UnlockScreen, { channelId: conv.channelId }, "LocalHideUnlock");

    const reset = () => {
        showConfirmationAlert({
            title: "Reset LocalHide Archive",
            content:
                "This permanently deletes the locally encrypted archive for this conversation. Discord's messages are not touched.",
            confirmText: "Delete",
            cancelText: "Cancel",
            onConfirm: () => {
                void archives.resetArchive(conv.channelId).then(() => {
                    showToast("Archive reset");
                    onChanged();
                });
            }
        } as any);
    };

    return (
        <View style={styles.row}>
            <Pressable onPress={open} style={styles.rowMain}>
                {avatarUri ? (
                    <Image source={avatarUri} style={styles.avatar} />
                ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarLetter}>{name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                )}
                <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                        {name}
                    </Text>
                    <Text style={styles.sub}>{`${conv.count} hidden`}</Text>
                </View>
            </Pressable>
            <Pressable onPress={reset} hitSlop={8}>
                <Text style={[styles.resetBtn]}>Reset</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#1e1f22" },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#26272b"
    },
    back: { color: "#dbdee1", fontSize: 16 },
    title: { color: "#fff", fontSize: 16, fontWeight: "600" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#26272b"
    },
    rowMain: { flex: 1, flexDirection: "row", alignItems: "center" },
    avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
    avatarFallback: { backgroundColor: "#5865F2", alignItems: "center", justifyContent: "center" },
    avatarLetter: { color: "#fff", fontWeight: "700", fontSize: 17 },
    name: { color: "#f2f3f5", fontSize: 15, fontWeight: "600" },
    sub: { color: "#949ba4", fontSize: 13, marginTop: 1 },
    resetBtn: { color: "#f23f43", fontSize: 14, fontWeight: "600", paddingHorizontal: 8 }
});
