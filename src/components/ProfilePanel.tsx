import { Forms } from "@vendetta/ui/components";
import { openScreen } from "../lib/modal";
import UnlockScreen from "../screens/Unlock";

/**
 * Injected profile section. Uses the app's own Form components so it matches
 * Discord profile styling and adapts to themes automatically.
 */
export default function LocalHideProfilePanel({
    channelId,
    count
}: {
    channelId: string;
    userId: string;
    count: number;
}) {
    const { FormSection, FormRow, FormDivider } = Forms as any;

    return (
        <FormSection title="LocalHide">
            <FormRow
                label={`${count} hidden message${count === 1 ? "" : "s"}`}
                subLabel="Protected by LocalHide"
                arrow
                onPress={() => {
                    void openScreen(UnlockScreen, { channelId }, "LocalHideUnlock");
                }}
            />
            <FormDivider />
        </FormSection>
    );
}
