import * as React from 'react';
import { Platform } from 'react-native';

export interface ResizableColumnOptions {
    /** Stable key per column (e.g. "sidebar", "right-panel"). */
    key: string;
    /** Default width if no persisted value. */
    defaultWidth: number;
    /** Hard floor (px). */
    minWidth: number;
    /** Hard ceiling (px). */
    maxWidth: number;
}

/**
 * Stateful width for a draggable column. Width is persisted between sessions.
 * Returns [width, setWidth] tuple plus a `commit` callback to flush the final
 * value when the user releases the drag (avoids spamming storage on every px).
 *
 * Mobile / native: returns the default width and a no-op setter. Resize is web/desktop only.
 */
export function useResizableColumn({ key, defaultWidth, minWidth, maxWidth }: ResizableColumnOptions) {
    const isWeb = Platform.OS === 'web';
    const [width, setWidth] = React.useState<number>(() => {
        if (!isWeb) return defaultWidth;
        return readPersisted(key) ?? defaultWidth;
    });

    const setClamped = React.useCallback((next: number) => {
        if (!isWeb) return;
        const clamped = Math.max(minWidth, Math.min(maxWidth, next));
        setWidth(clamped);
    }, [isWeb, minWidth, maxWidth]);

    const commit = React.useCallback((next: number) => {
        if (!isWeb) return;
        const clamped = Math.max(minWidth, Math.min(maxWidth, next));
        setWidth(clamped);
        persistWidth(key, clamped);
    }, [isWeb, key, minWidth, maxWidth]);

    return { width, setWidth: setClamped, commit };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE STRATEGY — TODO(siki): pick A / B / C below and replace the body
// of `readPersisted` and `persistWidth`. Trade-offs:
//
// A. localStorage-only (web only)
//    - Fastest, zero network, device-local
//    - Resizing on laptop won't propagate to desktop browser
//    - Good if column width is "muscle memory per device"
//
// B. happy localSettings (synced via server)
//    - Survives across user's devices
//    - Adds 2 keys to localSettings schema (sidebarWidth, rightPanelWidth)
//    - Slight delay on initial paint (storage hydration)
//
// C. Hybrid: localStorage for instant paint, sync to localSettings on commit
//    - Best UX but most code (~15 lines)
//    - Worth it if you care about cross-device consistency
//
// Default in skeleton: A (localStorage only) — change as needed.
// ─────────────────────────────────────────────────────────────────────────────

function readPersisted(key: string): number | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(`columnWidth:${key}`);
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

function persistWidth(key: string, width: number) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(`columnWidth:${key}`, String(width));
    } catch {
        // localStorage may be unavailable (private mode, quota); silently degrade.
    }
}
