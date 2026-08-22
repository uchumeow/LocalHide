import { getUserStore, getChannelStore, findByStoreNameSafe } from "./metro";

export interface SnapshotInput {
    id: string;
    channelId: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: string;
    editedTimestamp?: string | null;
    outgoing: boolean;
    type?: number;
    reply?: { messageId: string; authorName?: string; contentPreview?: string } | null;
    attachments?: Array<{
        filename?: string;
        contentType?: string | null;
        size?: number | null;
        url?: string | null;
    }>;
    embeds?: Array<{ title?: string; description?: string }>;
}

/** Look up a cached Discord message by id (read-only; never mutated). */
export function getMessageById(channelId: string, messageId: string): any | null {
    try {
        const store = findByStoreNameSafe("MessageStore");
        return store?.getMessage?.(channelId, messageId) ?? null;
    } catch {
        return null;
    }
}

export function isOneToOneDm(channel: any): boolean {
    // 1 = DM; group DMs (3) and everything else stay out of scope for v1
    return channel?.type === 1;
}

export function getOtherUserId(channel: any): string | null {
    const recipients: unknown = channel?.recipients;
    if (Array.isArray(recipients) && recipients.length === 1) {
        const r = recipients[0];
        if (typeof r === "string") return r;
        if (typeof r?.id === "string") return r.id;
    }
    return null;
}

export function getChannel(channelId: string): any {
    try {
        return getChannelStore()?.getChannel(channelId) ?? null;
    } catch {
        return null;
    }
}

export function getUserName(userId: string): string | null {
    try {
        const user = getUserStore()?.getUser(userId);
        return user?.globalName ?? user?.username ?? null;
    } catch {
        return null;
    }
}

export function getCurrentUserId(): string | null {
    try {
        return getUserStore()?.getCurrentUser()?.id ?? null;
    } catch {
        return null;
    }
}

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/**
 * Convert a Discord message object into a LocalHide archive snapshot.
 * Only metadata and text are captured; attachment binaries are never
 * downloaded or duplicated. Embeds are reduced to short text fields.
 */
export function buildSnapshot(message: any): SnapshotInput {
    const author = message?.author ?? {};
    const snapshot: SnapshotInput = {
        id: String(message.id),
        channelId: asString(message.channel_id ?? message.channelId),
        authorId: String(author.id ?? "0"),
        authorName:
            asString(author.globalName) ||
            asString(author.username) ||
            (author.id != null ? "User" : "Unknown"),
        content: typeof message.content === "string" ? message.content : "",
        timestamp: asString(message.timestamp, new Date().toISOString()),
        editedTimestamp: (message.editedTimestamp ?? message.edited_timestamp ?? null) as string | null,
        outgoing: false,
        type: typeof message.type === "number" ? message.type : 0,
        reply: null,
        attachments: [],
        embeds: []
    };
    snapshot.outgoing = author.id != null && String(author.id) === getCurrentUserId();

    const ref = message.referenced_message ?? message.messageReference ?? message.message_reference;
    const refId = ref?.id ?? ref?.message_id;
    if (refId) {
        const refAuthor = ref.author;
        snapshot.reply = {
            messageId: String(refId),
            authorName: asString(refAuthor?.globalName) || asString(refAuthor?.username) || undefined,
            contentPreview: typeof ref.content === "string" ? ref.content.slice(0, 120) : undefined
        };
    }

    for (const a of Array.isArray(message.attachments) ? message.attachments : []) {
        if (!a || typeof a !== "object") continue;
        snapshot.attachments!.push({
            filename: asString(a.filename, "file"),
            contentType: (a.content_type ?? a.contentType ?? null) as string | null,
            size: typeof a.size === "number" ? a.size : null,
            url: asString(a.url) || null
        });
    }

    for (const e of Array.isArray(message.embeds) ? message.embeds : []) {
        if (!e || typeof e !== "object") continue;
        const title =
            typeof e.title === "string" ? e.title : typeof e.rawTitle === "string" ? e.rawTitle : undefined;
        const description =
            typeof e.description === "string"
                ? e.description
                : typeof e.rawDescription === "string"
                  ? e.rawDescription
                  : undefined;
        if (title !== undefined || description !== undefined) {
            snapshot.embeds!.push({
                title: title?.slice(0, 256),
                description: description?.slice(0, 1024)
            });
        }
    }

    return snapshot;
}
