import { React } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { stateStore } from "./storage/store";
import { archives } from "./storage/archives";
import { openScreen } from "./lib/modal";
import ManageConversations from "./screens/Manage";
import { featureStatus } from "./lib/metro";
import { SCHEMA_VERSION } from "./storage/schema";
import { isDebugEnabled, setDebugEnabled } from "./lib/logger";

/**
 * LocalHide settings page.
 */
export default function Settings() {
    const { FormSection, FormRow, FormDivider, FormSwitchRow, FormText } = Forms as any;
    const [, force] = React.useReducer(n => ~n, 0);
    React.useEffect(() => stateStore.subscribe(force), []);

    const totals = stateStore.totals();

    return (
        <>
            <FormSection title="LocalHide">
                <FormRow label="Status" trailing={<FormText>{`Active · schema v${SCHEMA_VERSION}`}</FormText>} />
                <FormDivider />
                <FormRow label="Protected conversations" trailing={<FormText>{String(totals.conversations)}</FormText>} />
                <FormDivider />
                <FormRow label="Locally hidden messages" trailing={<FormText>{String(totals.messages)}</FormText>} />
            </FormSection>

            <FormSection title="Manage">
                <FormRow
                    label="Manage Protected Conversations"
                    arrow
                    onPress={() => void openScreen(ManageConversations, {}, "LocalHideManage")}
                />
            </FormSection>

            <FormSection title="Diagnostics (no message content)">
                <FormSwitchRow
                    label="Verbose diagnostics"
                    subLabel="Logs ids and counts only; never contents or keys."
                    leading={undefined}
                    value={isDebugEnabled()}
                    onValueChange={(v: boolean) => {
                        setDebugEnabled(v);
                        force();
                    }}
                />
                <FormDivider />
                <FormRow
                    label="Feature availability"
                    trailing={
                        <FormText>
                            {[
                                `actions:${featureStatus.actionSheet ? "ok" : "n/a"}`,
                                `filter:${featureStatus.rowFilter ? "ok" : "bs"}`,
                                `profile:${featureStatus.profilePanel ? "ok" : "n/a"}`
                            ].join("  ")}
                        </FormText>
                    }
                />
            </FormSection>

            <FormSection title="About">
                <FormRow label="LocalHide" trailing={<FormText>v0.1.0</FormText>} />
                <FormDivider />
                <FormRow label="by uchumeow" trailing={undefined} />
                <FormDivider />
                <FormRow
                    label="Local only"
                    trailing={undefined}
                    subLabel="No analytics, no network requests, no Discord mutations. Hiding affects your device only."
                />
            </FormSection>
        </>
    );
}
