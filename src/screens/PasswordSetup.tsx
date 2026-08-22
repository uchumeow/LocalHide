import { React, NavigationNative } from "@vendetta/metro/common";
import { Text, TextInput, View, Pressable, StyleSheet, ScrollView } from "react-native";
import { pendingHide } from "../state/selection";
import { archives } from "../storage/archives";
import { closeTopScreen } from "../lib/modal";
import { showToast } from "@vendetta/ui/toasts";
import { log } from "../lib/logger";

const MIN_PASSWORD_LENGTH = 8;

/**
 * First-hide setup flow for a conversation. Explains what LocalHide does,
 * collects a password + confirmation, creates the encrypted archive and then
 * commits the hide that triggered this flow.
 */
export default function PasswordSetupScreen({ channelId }: { channelId: string }) {
    const [password, setPassword] = React.useState("");
    const [confirm, setConfirm] = React.useState("");
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    const cancel = () => {
        pendingHide.clear();
        closeTopScreen();
    };

    const submit = async () => {
        if (password.length < MIN_PASSWORD_LENGTH) {
            setErrorText(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setErrorText("Passwords do not match.");
            return;
        }

        const pending = pendingHide.take();
        setBusy(true);
        try {
            await archives.createArchive(channelId, pending?.meta.userId ?? null, pending?.meta.displayName ?? null, password);
            if (pending) {
                await archives.hideMessages(pending.channelId, pending.snapshots, pending.meta);
            }
            // clear sensitive inputs immediately
            setPassword("");
            setConfirm("");
            showToast("Archive created");
            log("archive created; committing", pending?.snapshots.length ?? 0, "hidden message(s)");
            closeTopScreen();
        } catch (e) {
            setErrorText("Could not create the archive. Try again.");
            log("create archive failed:", e instanceof Error ? e.message : e);
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.title}>Protect Hidden Messages</Text>
                <Text style={styles.body}>
                    Hidden messages in this conversation are saved only on your iPhone. You will use a
                    password to view them later from this person's profile.
                </Text>
                <Text style={styles.warn}>
                    There is no password recovery. If you forget it you can reset LocalHide's archive,
                    which permanently deletes locally stored hidden messages.
                </Text>

                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#7c7f88"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="off"
                    textContentType="newPassword"
                    value={password}
                    onChangeText={(t: string) => {
                        setPassword(t);
                        setErrorText(null);
                    }}
                    maxLength={128}
                />
                <TextInput
                    style={styles.input}
                    placeholder="Confirm password"
                    placeholderTextColor="#7c7f88"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="off"
                    textContentType="newPassword"
                    value={confirm}
                    onChangeText={(t: string) => {
                        setConfirm(t);
                        setErrorText(null);
                    }}
                    maxLength={128}
                />

                {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

                <Pressable disabled={busy} onPress={() => void submit()} style={({ pressed }: any) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}>
                    <Text style={styles.primaryText}>{busy ? "Creating…" : "Create Archive & Hide"}</Text>
                </Pressable>
                <Pressable onPress={cancel} hitSlop={8}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#1e1f22" },
    content: { flexGrow: 1, justifyContent: "center", padding: 24 },
    title: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 12 },
    body: { color: "#dbdee1", fontSize: 15, lineHeight: 21, marginBottom: 10 },
    warn: { color: "#f0b232", fontSize: 13, lineHeight: 19, marginBottom: 20 },
    input: {
        backgroundColor: "#111214",
        borderColor: "#26272b",
        borderWidth: 1,
        borderRadius: 8,
        color: "#fff",
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 16,
        marginBottom: 12
    },
    error: { color: "#f23f43", fontSize: 13, marginBottom: 10 },
    primary: {
        backgroundColor: "#5865F2",
        borderRadius: 8,
        alignItems: "center",
        paddingVertical: 13,
        marginTop: 6,
        marginBottom: 16
    },
    primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
    cancelText: { color: "#949ba4", textAlign: "center", fontSize: 15 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 }
});
