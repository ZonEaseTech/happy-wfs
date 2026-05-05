import * as React from 'react';
import { sessionListDirectory } from './ops';
import type { DirEntry } from './ops';

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
 * Lazy directory-tree state for a session.
 *
 * Each level is fetched on-demand via sessionListDirectory; results are cached
 * in `entries` keyed by absolute path. The visible `tree` is a recursive
 * projection of the initial path's children, attaching children for any node
 * whose path is in `expanded`.
 */
export function useDirectoryTree(
    sessionId: string,
    initialPath: string,
): UseDirectoryTreeResult {
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
            const response = await sessionListDirectory(sessionId, path);
            if (response.success && response.entries) {
                setEntries(prev => {
                    const next = new Map(prev);
                    next.set(path, response.entries!);
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
    }, [sessionId, setLoading, setError]);

    // Always load the root once on mount / when sessionId or initialPath change.
    React.useEffect(() => {
        if (!sessionId || !initialPath) return;
        void load(initialPath);
    }, [sessionId, initialPath, load]);

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
