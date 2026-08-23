import { React } from "@vendetta/metro/common";
import { getLazyActionSheet, featureStatus } from "../lib/metro";
import { buildSnapshot, getChannel, getOtherUserId, getUserName } from "../lib/snapshot";
import { archives } from "../storage/archives";
import { pendingHide, selection } from "../state/selection";
import { openScreen } from "../lib/modal";
import PasswordSetupScreen from "../screens/PasswordSetup";
import { log } from "../lib/logger";

interface Props {
    message: any;
    ActionSheetRow: any;
    FormRow: any;
    iconHide?: number;
    iconSelect?: number;
    selectionAvailable?: boolean;
}

/**
 * The injected action rows. Rendered as a fragment so it can be pushed into
 * an existing row array without changing Discord's layout.
 */
export default function HideRows({ message, ActionSheetRow, FormRow, iconHide, iconSelect, selectionAvailable }: Props) {
    const onPressHide = () => {
        try {
            closeSheet();
            void handleHide(message);
        } catch (e) {
            log("hide failed:", e instanceof Error ? e.message : e);
        }
    };

    const onPressSelect = () => {
        if (!selectionAvailable && !featureStatus.selectionBanner) {
            log("selection mode unavailable (ChatView overlay not found on this build)");
            return;
        }
        closeSheet();
        selection.enter(String(message.channel_id ?? message.channelId));
    };

    const Row = ActionSheetRow ?? FormRow;
    if (!Row) return null;

    return (
        <>
            <Row
                label="Hide Locally"
                leading={<Row.Icon source={iconHide ?? 0} style={{ opacity: 1 }} />}
                onPress={onPressHide}
            />
            <Row
                label="Select Messages"
                leading={<Row.Icon source={iconSelect ?? 0} style={{ opacity: 1 }} />}
                onPress={onPressSelect}
            />
        </>
    );
}

function closeSheet() {
    try {
        getLazyActionSheet()?.hideActionSheet();
    } catch {}
}

async function handleHide(message: any) {
    closeSheet();

    const channelId = String(message.channel_id ?? message.channelId);
    const channel = getChannel(channelId);
    const otherUserId = getOtherUserId(channel);
    const meta = {
        userId: otherUserId,
        displayName: otherUserId ? getUserName(otherUserId) : null
    };
    const snapshot = buildSnapshot(message);

    if (!archives.hasArchive(channelId)) {
        pendingHide.begin(channelId, [snapshot], meta);
        await openScreen(PasswordSetupScreen, { channelId }, "LocalHideSetup");
        return;
    }

    await archives.hideMessages(channelId, [snapshot], meta);
    log("hid message", snapshot.id.slice(-6), "in", channelId.slice(-4));
}
