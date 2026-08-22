let debugEnabled = false;

const PREFIX = "[LocalHide]";

export function setDebugEnabled(v: boolean) {
    debugEnabled = v;
}

export function isDebugEnabled() {
    return debugEnabled;
}

export function log(...args: unknown[]) {
    console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]) {
    console.warn(PREFIX, ...args);
}

export function error(...args: unknown[]) {
    console.error(PREFIX, ...args);
}

/**
 * Diagnostic logging. Must NEVER receive message contents, passwords or keys.
 * Only ids, counts and status flags are allowed through here.
 */
export function dbg(...args: unknown[]) {
    if (debugEnabled) console.log(PREFIX, "[dbg]", ...args);
}
