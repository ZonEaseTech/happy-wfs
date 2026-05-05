import * as React from 'react';
import { sessionListDirectory } from './ops';
import type { DirEntry, SessionListDirectoryResponse } from './ops';

export interface DirectoryTreeNode {
    entry: DirEntry;
    children?: DirectoryTreeNode[];
    expanded: boolean;
}

export interface UseDirectoryTreeResult {
    tree: DirectoryTreeNode[];
    expand: (path: string) => Promise<void>;
    collapse: (path: string) => void;
    refresh: (path: string) => Promise<void>;
    isLoading: Map<string, boolean>;
    errors: Map<string, string>;
}

/**
 * Optional listDirectory function — when provided, it replaces the default
 * session-scoped sessionListDirectory call. Used by FileViewerModal in
 * machine mode (no session id) to call machineListDirectory instead.
 */
export type ListDirectoryFn = (path: string) => Promise<SessionListDirectoryResponse>;

/**
 * Lazy directory-tree state for a session or machine.
 *
 * `entityId` is just used to re-key the effect that loads the initial path
 * (and as a dependency on the load callback) — it is NOT passed into the RPC
 * directly, since the listDirectoryFn already closes over the session/machine
 * id it needs.
 *
 * Each level is fetched on-demand; results are cached in `entries` keyed by
 * absolute path. The visible `tree` is a recursive projection of the initial
 * path's children, attaching children for any node whose path is in `expanded`.
 */
export function useDirectoryTree(
    entityId: string,
    initialPath: string,
    listDirectoryFn?: ListDirectoryFn,
): UseDirectoryTreeResult {
    // The listFn closure changes on every parent render (callers don't generally
    // memoize), so we keep a ref to the latest version. `load` then stays stable
    // and the load-on-mount effect doesn't refire on every render.
    const listFnRef = React.useRef<ListDirectoryFn>(
        listDirectoryFn ?? ((path: string) => sessionListDirectory(entityId, path)),
    );
    React.useEffect(() => {
        listFnRef.current = listDirectoryFn ?? ((path: string) => sessionListDirectory(entityId, path));
    }, [listDirectoryFn, entityId]);

    const [entries, setEntries] = React.useState<Map<string, DirEntry[]>>(() => new Map());
    const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
    const [isLoading, setIsLoading] = React.useState<Map<string, boolean>>(() => new Map());
    const [errors, setErrors] = React.useState<Map<string, string>>(() => new Map());

    const setLoading = React.useCallback((path: string, loading: boolean) => {
        setIsLoading(prev => {
            const next = new Map(prev);
            if (loading) next.set(path, true);
            else next.delete(path);
            return next;
        });
    }, []);

    const setError = React.useCallback((path: string, message: string | null) => {
        setErrors(prev => {
            const next = new Map(prev);
            if (message) next.set(path, message);
            else next.delete(path);
            return next;
        });
    }, []);

    const load = React.useCallback(async (path: string): Promise<void> => {
        setLoading(path, true);
        setError(path, null);
        try {
            const response = await listFnRef.current(path);
            if (response.success && response.entries) {
                // Normalize entries to be forward-compatible with older happy-cli versions
                // (npm-installed CLIs in the wild) that return {name, type:'directory'|'file'|
                // 'other', size, modified} WITHOUT a `path` field. Without this normalization
                // entry.path is undefined and triggers a `paths[1] must be of type string` error
                // on the next listDirectory / readFile RPC.
                const normalized = response.entries.map((raw: any) => {
                    const t = raw.type;
                    const type: 'file' | 'dir' = (t === 'dir' || t === 'directory') ? 'dir' : 'file';
                    const fallbackPath = path.endsWith('/') ? `${path}${raw.name}` : `${path}/${raw.name}`;
                    return {
                        name: raw.name,
                        path: typeof raw.path === 'string' ? raw.path : fallbackPath,
                        type,
                        size: raw.size,
                        mtime: typeof raw.mtime === 'number' ? raw.mtime : raw.modified,
                    };
                });
                // Older CLIs ignore hideSystem; do a client-side scrub so we don't render
                // .git / node_modules / .DS_Store / *.lock when the server didn't filter.
                const NOISE = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.DS_Store', '.next', '.expo']);
                const visible = normalized.filter(e => !NOISE.has(e.name) && !e.name.endsWith('.lock'));
                setEntries(prev => {
                    const next = new Map(prev);
                    next.set(path, visible);
                    return next;
                });
            } else {
                setError(path, response.error || 'Failed to list directory');
            }
        } catch (e) {
            setError(path, e instanceof Error ? e.message : 'Failed to list directory');
        } finally {
            setLoading(path, false);
        }
    }, [setLoading, setError]);

    // Always load the root once on mount / when entityId or initialPath change.
    React.useEffect(() => {
        if (!entityId || !initialPath) return;
        void load(initialPath);
    }, [entityId, initialPath, load]);

    const expand = React.useCallback(async (path: string) => {
        setExpanded(prev => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
        });
        if (!entries.has(path)) {
            await load(path);
        }
    }, [entries, load]);

    const collapse = React.useCallback((path: string) => {
        setExpanded(prev => {
            if (!prev.has(path)) return prev;
            const next = new Set(prev);
            next.delete(path);
            return next;
        });
        // Drop the cached entries too so revisiting a large repo doesn't grow
        // the Map unboundedly. Re-expand will re-fetch (cheap, and keeps things fresh).
        setEntries(prev => {
            if (!prev.has(path)) return prev;
            const next = new Map(prev);
            next.delete(path);
            return next;
        });
    }, []);

    const refresh = React.useCallback(async (path: string) => {
        await load(path);
    }, [load]);

    const tree = React.useMemo<DirectoryTreeNode[]>(() => {
        const build = (path: string): DirectoryTreeNode[] => {
            const list = entries.get(path);
            if (!list) return [];
            return list.map(entry => {
                const isDir = entry.type === 'dir';
                const isExpanded = isDir && expanded.has(entry.path);
                const node: DirectoryTreeNode = {
                    entry,
                    expanded: isExpanded,
                };
                if (isExpanded) {
                    node.children = build(entry.path);
                }
                return node;
            });
        };
        return build(initialPath);
    }, [entries, expanded, initialPath]);

    return { tree, expand, collapse, refresh, isLoading, errors };
}
