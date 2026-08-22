import { after } from "@vendetta/patcher";
import { React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { featureStatus, getUserProfileSection, resolveWithRetry } from "../lib/metro";
import { stateStore } from "../storage/store";
import LocalHideProfilePanel from "../components/ProfilePanel";
import { log, warn } from "../lib/logger";

/**
 * Profile integration: inject a LocalHide section into a user's profile when
 * an archive exists for our DM with them. Only the section is injected;
 * Discord's own profile rendering is untouched.
 */

let unpatch: (() => void) | null = null;

export async function patchProfilePanel(): Promise<void> {
    const Section = await resolveWithRetry(getUserProfileSection, 20, 1500);
    if (typeof Section !== "function") {
        warn("UserProfileSection not found - profile panel unavailable");
        return;
    }

    unpatch = after("default", Section as any, ([props]: any[], rendered: any) => {
        try {
            const user = props?.user ?? rendered?.props?.user ?? props?.userId;
            const userId = typeof user === "object" ? String(user?.id ?? "") : String(user ?? "");
            if (!userId) return rendered;

            const channelId = stateStore.getUserIdIndex().get(userId);
            if (!channelId) return rendered; // no archive for this user -> no panel

            const conv = stateStore.getConversation(channelId);
            if (!conv || conv.count <= 0) return rendered;

            const panel = React.createElement(LocalHideProfilePanel, {
                channelId,
                userId,
                count: conv.count
            });

            // Prefer appending into the profile's existing column array.
            const column: any[] | undefined = findInReactTree(
                rendered,
                (c: any) => Array.isArray(c) && c.length >= 1 && c.every((x: any) => x && (x.props ?? x.type))
            );
            if (Array.isArray(column)) {
                column.push(panel);
                return rendered;
            }

            // Fallback: wrap.
            return React.createElement(React.Fragment, null, rendered, panel);
        } catch {
            return rendered;
        }
    });

    featureStatus.profilePanel = true;
    log("profile panel patch installed");
}

export function unpatchProfilePanel(): void {
    try {
        unpatch?.();
    } catch {}
    unpatch = null;
}
