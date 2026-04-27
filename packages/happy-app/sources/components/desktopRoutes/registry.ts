import * as React from 'react';

type Loader = () => Promise<{ default: React.ComponentType<any> }>;

const map = new Map<string, Loader>();

/**
 * Register an expo-router page so it can be opened as a desktop drawer.
 * Call once per page at module top-level.
 */
export function registerDesktopRoute(path: string, loader: Loader): void {
    map.set(path, loader);
}

export function hasDesktopRoute(path: string): boolean {
    return map.has(stripQuery(path));
}

export function loadDesktopRoute(path: string): Loader | undefined {
    return map.get(stripQuery(path));
}

function stripQuery(path: string): string {
    const i = path.indexOf('?');
    return i === -1 ? path : path.slice(0, i);
}

export function parseQuery(path: string): Record<string, string> {
    const i = path.indexOf('?');
    if (i === -1) return {};
    const qs = path.slice(i + 1);
    const out: Record<string, string> = {};
    for (const part of qs.split('&')) {
        if (!part) continue;
        const [k, v] = part.split('=');
        out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    return out;
}
