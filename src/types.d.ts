import * as React from "react";

declare global {
    interface Window {
        modules?: Record<number, any>;
        __r?: (id: number) => any;
        nativeModuleProxy?: Record<string, any>;
    }
    // Hermes runtime globals used by Kettu/Discord
    const __turboModuleProxy: ((name: string) => any) | undefined;
}

export {};
