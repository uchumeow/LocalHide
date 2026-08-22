import { React } from "@vendetta/metro/common";
import { FlatList, Text, View, Pressable, StyleSheet } from "react-native";
import { archives } from "../storage/archives";
import type { ArchivedMessage } from "../storage/schema";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { showToast } from "@vendetta/ui/toasts";
import { closeTopScreen } from "../lib/modal";
import { log } from "../lib/logger";

/**
 * The hidden-messages archive view. Chronological FlatList (efficient with
 * thousands of records), outgoing/incoming distinction, single + bulk restore
 * and destructive Restore All / Reset Archive behind confirmations.
 *
 * Decrypted snapshots live only in this screen's state and are dropped when
 * it unmounts.
 */
export default function ArchiveScreen({ channelId }: { channelId: string }) {
    const [messages, setMessages] = React.useState<ArchivedMessage[] | null>(null);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [selectMode, setSelectMode] = React.useState(false);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        let alive = true;
        archives
            .getArchivedMessages(channelId)
            .then(msgs => alive && setMessages(msgs))
            .catch((e: unknown) => {
                if (!alive) return;
                setLoadError(e instanceof Error ? e.message : "Failed to load archive");
            });
        return () => {
            alive = false;
        };
    }, [channelId]);

    const restore = async (ids: string[], label: string) => {
        try {
            await archives.restoreMessages(channelId, ids);
            setMessages(prev => (prev ? prev.filter(m => !ids.includes(m.id)) : prev));
            setSelected(new Set());
            showToast(`Restored ${label}`);
            log("restored", label, "in", channelId.slice(-4));
        } catch (e) {
            showToast("Restore failed");
            log("restore failed:", e instanceof Error ? e.message : e);
        }
    };

    const toggle = (id: string) =>
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const exitSelect = () => {
        setSelectMode(false);
        setSelected(new Set());
    };

    const restoreAll = () => {
        if (!messages?.length) return;
        showConfirmationAlert({
            title: "Restore All Hidden Messages",
            content: `This will unhide all ${messages.length} message${messages.length === 1 ? "" : "s"} in this conversation. They will reappear in Discord.`,
            confirmText: "Restore All",
            cancelText: "Cancel",
            onConfirm: () => void restore(messages.map(m => m.id), `${messages.length} messages`)
        } as any);
    };

    const resetArchive = () => {
        showConfirmationAlert({
            title: "Reset LocalHide Archive",
            content:
                "Resetting permanently deletes the locally encrypted archive for this conversation, including all hidden messages. Messages still on Discord's servers are NOT deleted.",
            confirmText: "Delete Archive",
            cancelText: "Cancel",
            onConfirm: () => {
                void archives.resetArchive(channelId).then(() => {
                    showToast("Archive reset");
                    closeTopScreen();
                });
            }
        } as any);
    };

    if (loadError) {
        return (
            <View style={styles.centerRoot}>
                <Text style={styles.errorText}>Archive could not be opened ({loadError}).</Text>
            </View>
        );
    }

    if (!messages) {
        return (
            <View style={styles.centerRoot}>
                <Text style={{ color: "#949ba4" }}>Decrypting…</Text>
            </View>
        );
    }

    const selectionActive = selectMode;

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <Pressable onPress={() => closeTopScreen()} hitSlop={8}>
                    <Text style={styles.back}>‹ Back</Text>
                </Pressable>
                <Text style={styles.headerTitle}>{`${messages.length} hidden`}</Text>
                <Text style={[styles.action, styles.disabled]}>
                    {selectionActive ? "Tap to select" : ""}
                </Text>
            </View>

            {messages.length === 0 ? (
                <View style={styles.centerRoot}>
                    <Text style={{ color: "#949ba4" }}>No hidden messages.</Text>
                </View>
            ) : (
                <FlatList
                    data={messages}
                    keyExtractor={(m: ArchivedMessage) => m.id}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={11}
                    renderItem={({ item }: any) => (
                        <MessageRow
                            msg={item as ArchivedMessage}
                            selected={selected.has(item.id)}
                            selectionActive={false}
                            onToggle={() => {}}
                        />
                    )}
                />
            )}

            <View style={styles.footer}>
                <Pressable
                    onPress={() => {
                        if (!messages.length) return;
                        if (selectMode) exitSelect();
                        else setSelectMode(true);
                    }}
                    hitSlop={8}
                >
                    <Text style={styles.footerBtn}>{selectMode ? "Exit Selection" : "Select"}</Text>
                </Pressable>
                <Pressable
                    disabled={!selectMode || !selected.size}
                    onPress={() => void restore([...selected], `${selected.size}`)}
                    hitSlop={8}
                >
                    <Text style={[styles.footerBtn, (!selectMode || !selected.size) && styles.disabled]}>
                        {`Restore Selected${selected.size ? ` (${selected.size})` : ""}`}
                    </Text>
                </Pressable>
                <Pressable onPress={restoreAll} hitSlop={8}>
                    <Text style={[styles.footerBtn, styles.danger]}>Restore All</Text>
                </Pressable>
                <Pressable onPress={resetArchive} hitSlop={8}>
                    <Text style={[styles.footerBtn, styles.danger]}>Reset</Text>
                </Pressable>
            </View>
        </View>
    );
}

function MessageRow({
    msg,
    selected,
    selectionActive,
    onToggle
}: {
    msg: ArchivedMessage;
    selected: boolean;
    selectionActive: boolean;
    onToggle: () => void;
}) {
    const time = new Date(msg.timestamp).toLocaleString();

    return (
        <Pressable
            disabled={!selectionActive}
            onPress={onToggle}
            style={[styles.rowWrap, selected && styles.rowSelected]}
        >
            <View style={[styles.bubble, msg.outgoing ? styles.outgoing : styles.incoming]}>
                <View style={styles.rowHeader}>
                    <Text style={[styles.author, { color: msg.outgoing ? "#8ea1ff" : "#f2b177" }]} numberOfLines={1}>
                        {msg.outgoing ? `${msg.authorName} · you` : msg.authorName}
                    </Text>
                    <Text style={styles.time}>{time}</Text>
                </View>
                {msg.reply?.messageId ? (
                    <View style={styles.replyBox}>
                        <Text style={styles.replyText} numberOfLines={2}>
                            ↩ {msg.reply.authorName ?? "Reply"}: {msg.reply.contentPreview ?? "(content unavailable)"}
                        </Text>
                    </View>
                ) : null}
                {msg.content ? <Text style={styles.content}>{msg.content}</Text> : null}
                {(msg.attachments?.length ?? 0) > 0 ? (
                    <View style={{ marginTop: 4 }}>
                        {msg.attachments!.map((a, i) => (
                            <Text key={`${msg.id}-a${i}`} style={styles.metaText} numberOfLines={1}>
                                📎 {a.filename}
                                {a.contentType ? ` · ${a.contentType}` : ""}
                                {typeof a.size === "number" ? ` · ${(a.size / 1024).toFixed(0)} KB` : ""}
                            </Text>
                        ))}
                    </View>
                ) : null}
                {(msg.embeds?.length ?? 0) > 0 ? (
                    <View style={{ marginTop: 4 }}>
                        {msg.embeds!.map((e, i) => (
                            <Text key={`${msg.id}-e${i}`} style={styles.metaText} numberOfLines={2}>
                                ▤ {e.title ?? ""} {e.description ? `— ${e.description.slice(0, 120)}` : ""}
                            </Text>
                        ))}
                    </View>
                ) : null}
                {!msg.content && !(msg.attachments?.length ?? 0) && !(msg.embeds?.length ?? 0) ? (
                    <Text style={[styles.content, { fontStyle: "italic", color: "#7c7f88" }]}>No text content</Text>
                ) : null}
                {msg.editedTimestamp ? <Text style={styles.edited}>(edited)</Text> : null}
            </View>
            {selectionActive ? (
                <View style={[styles.checkCircle, selected && styles.checkCircleOn]} pointerEvents="none">
                    {selected ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#1e1f22" },
    centerRoot: { flex: 1, backgroundColor: "#1e1f22", alignItems: "center", justifyContent: "center" },
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
    headerTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
    action: { color: "#8ea1ff", fontSize: 15, fontWeight: "600" },
    errorText: { color: "#f23f43", marginHorizontal: 24, textAlign: "center" },
    rowWrap: { paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", alignItems: "center" },
    rowSelected: { backgroundColor: "#5865F21A", borderRadius: 8 },
    bubble: { flex: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
    outgoing: { backgroundColor: "#2b2d5c" },
    incoming: { backgroundColor: "#2b2d31" },
    rowHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
    author: { fontWeight: "600", fontSize: 14, flexShrink: 1 },
    time: { color: "#949ba4", fontSize: 11, marginLeft: 8 },
    replyBox: {
        borderLeftWidth: 2,
        borderLeftColor: "#5865F2",
        paddingLeft: 6,
        marginBottom: 3
    },
    replyText: { color: "#b5bac1", fontSize: 12 },
    content: { color: "#dbdee1", fontSize: 15, lineHeight: 20 },
    metaText: { color: "#b5bac1", fontSize: 13 },
    edited: { color: "#7c7f88", fontSize: 11, marginTop: 2 },
    checkCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: "#5865F2",
        marginLeft: 8,
        alignItems: "center",
        justifyContent: "center"
    },
    checkCircleOn: { backgroundColor: "#5865F2" },
    checkMark: { color: "#fff", fontSize: 13, fontWeight: "700" },
    footer: {
        flexDirection: "row",
        justifyContent: "space-around",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#26272b",
        paddingVertical: 12
    },
    footerBtn: { color: "#8ea1ff", fontSize: 14, fontWeight: "600" },
    danger: { color: "#f23f43" },
    disabled: { opacity: 0.4 }
});
