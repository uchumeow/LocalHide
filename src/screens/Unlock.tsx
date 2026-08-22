import { React } from "@vendetta/metro/common";
import { Text, TextInput, View, Pressable, StyleSheet, ScrollView } from "react-native";
import { archives } from "../storage/archives";
import ArchiveScreen from "./Archive";
import { log } from "../lib/logger";

/**
 * Password gate shown before an archive can be viewed. On success it renders
 * the archive screen inline (same pushed screen) and locks again on close.
 */
export default function UnlockScreen({ channelId }: { channelId: string }) {
    const [unlocked, setUnlocked] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const [attempts, setAttempts] = React.useState(0);
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        return () => {
            // lock again whenever the screen closes
            archives.lockArchive(channelId);
        };
    }, [channelId]);

    const submit = async () => {
        if (!password.length) {
            setErrorText("Enter your password.");
            return;
        }
        setBusy(true);
        try {
            await archives.unlockArchive(channelId, password);
            setPassword("");
            setErrorText(null);
            setUnlocked(true);
            log("archive unlocked");
        } catch (e) {
            setAttempts(n => n + 1);
            setErrorText(
                attempts >= 2
                    ? "Incorrect password. Resetting the archive is available in LocalHide settings."
                    : "Incorrect password."
            );
            log("unlock failed (wrong password)");
        } finally {
            setBusy(false);
        }
    };

    if (unlocked) {
        return <ArchiveScreen channelId={channelId} />;
    }

    return (
        <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.title}>LocalHide</Text>
                <Text style={styles.body}>Enter this conversation's password to view hidden messages.</Text>

                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#7c7f88"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="off"
                    textContentType="password"
                    value={password}
                    onChangeText={(t: string) => {
                        setPassword(t);
                        setErrorText(null);
                    }}
                    maxLength={128}
                    onSubmitEditing={() => void submit()}
                />

                {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

                <Pressable
                    disabled={busy}
                    onPress={() => void submit()}
                    style={({ pressed }: any) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
                >
                    <Text style={styles.primaryText}>{busy ? "Unlocking…" : "Unlock"}</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#1e1f22" },
    content: { flexGrow: 1, justifyContent: "center", padding: 24 },
    title: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 10 },
    body: { color: "#dbdee1", fontSize: 15, lineHeight: 21, marginBottom: 20 },
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
        marginTop: 6
    },
    primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 }
});
