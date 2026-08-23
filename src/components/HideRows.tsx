import { React } from "@vendetta/metro/common";
import { getLazyActionSheet, featureStatus } from "../lib/metro";
import { buildSnapshot, getChannel, getOtherUserId, getUserName } from "../lib/snapshot";
import { archives } from "../storage/archives";
import { pendingHide, selection } from "../state/selection";
import { openScreen } from "../lib/modal";
import PasswordSetupScreen from "../screens/PasswordSetup";
import { log } from "../lib/logger";

export interface HideRowsProps {
    message: any;
    ActionSheetRow: any;
    FormRow: any;
    iconHide?: number;
    iconSelect?: number;
    selectionAvailable?: boolean;
}

export function createHideRows({ message, ActionSheetRow, FormRow, iconHide, iconSelect, selectionAvailable }: HideRowsProps) {
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
    if (!Row) return [];

    const icon = (source: number | undefined) => React.createElement(Row.Icon, { source: source ?? 0 });
    const iconProps = (source: number | undefined) =>
        ActionSheetRow ? { icon: icon(source) } : { leading: icon(source) };

    return [
        React.createElement(Row, {
            key: "localhide-hide",
            label: "Hide Locally",
            ...iconProps(iconHide),
            onPress: onPressHide
        }),
        React.createElement(Row, {
            key: "localhide-select",
            label: "Select Messages",
            ...iconProps(iconSelect),
            onPress: onPressSelect
        })
    ];
}

export default function HideRows(props: HideRowsProps) {
    return React.createElement(React.Fragment, null, ...createHideRows(props));
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
