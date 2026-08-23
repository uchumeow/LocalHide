/**
 * Bulk-selection mode state for the chat screen. Kept outside React so both
 * the injected banner and the patched message wrapper can observe it without
 * prop drilling through Discord's tree.
 */

interface SelectionState {
    active: boolean;
    channelId: string | null;
    selected: Set<string>;
}

type Listener = () => void;

class SelectionStore {
    private state: SelectionState;
    private listeners: Set<Listener>;

    constructor() {
        this.state = { active: false, channelId: null, selected: new Set() };
        this.listeners = new Set<Listener>();
    }

    get(): SelectionState {
        return this.state;
    }

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private emit() {
        for (const fn of [...this.listeners]) {
            try {
                fn();
            } catch {}
        }
    }

    enter(channelId: string) {
        this.state = { active: true, channelId, selected: new Set() };
        this.emit();
    }

    exit() {
        this.state = { active: false, channelId: null, selected: new Set() };
        this.emit();
    }

    isActiveFor(channelId: string | null | undefined): boolean {
        return this.state.active && this.state.channelId === channelId;
    }

    toggle(messageId: string) {
        if (!this.state.active) return;
        const selected = new Set(this.state.selected);
        selected.has(messageId) ? selected.delete(messageId) : selected.add(messageId);
        this.state = { ...this.state, selected };
        this.emit();
    }

    isSelected(messageId: string): boolean {
        return this.state.selected.has(messageId);
    }

    takeSelected(): string[] {
        return [...this.state.selected];
    }
}

export const selection = new SelectionStore();

/**
 * Messages queued to hide once a password/archive setup flow completes.
 */
class PendingHideStore {
    private channelId: string | null;
    private snapshots: any[];
    private meta: { userId: string | null; displayName: string | null } | null;

    constructor() {
        this.channelId = null;
        this.snapshots = [];
        this.meta = null;
    }

    begin(channelId: string, snapshots: any[], meta: { userId: string | null; displayName: string | null }) {
        this.channelId = channelId;
        this.snapshots = snapshots;
        this.meta = meta;
    }

    take(): { channelId: string; snapshots: any[]; meta: { userId: string | null; displayName: string | null } } | null {
        if (!this.channelId) return null;
        const out = {
            channelId: this.channelId,
            snapshots: this.snapshots,
            meta: this.meta ?? { userId: null, displayName: null }
        };
        this.clear();
        return out;
    }

    clear() {
        this.channelId = null;
        this.snapshots = [];
        this.meta = null;
    }
}

export const pendingHide = new PendingHideStore();
