import { SCHEMA_VERSION, validateState, type StateData } from "./schema";

/**
 * Migration pipeline. Each version upgrades the validated shape of the
 * previous one. v1 is the initial layout so no migrations exist yet; the
 * switch fallthrough pattern below shows exactly where future ones go.
 */
export function migrateState(raw: unknown): StateData {
    // capture the stored version before validation normalizes it
    const storedVersion =
        raw && typeof raw === "object" && typeof (raw as any).schemaVersion === "number"
            ? (raw as any).schemaVersion
            : NaN;

    if (storedVersion > SCHEMA_VERSION) {
        throw new Error(
            `LocalHide: stored schema (${storedVersion}) is newer than this plugin (${SCHEMA_VERSION}). Update LocalHide.`
        );
    }

    let data = validateState(raw);
    let from = Number.isNaN(storedVersion) ? data.schemaVersion : storedVersion;

    while (from < SCHEMA_VERSION) {
        switch (from) {
            // case 1: data = migrate1to2(data); from = 2; break;
            default: {
                throw new Error(`LocalHide: cannot migrate state from schema ${from}`);
            }
        }
    }

    // Re-validate against the current version's invariants.
    return validateState({ ...data, schemaVersion: SCHEMA_VERSION });
}
