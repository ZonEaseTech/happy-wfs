import * as React from 'react';
import { Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { hasDesktopRoute, parseQuery } from './registry';
import { isDesktopLayout } from './isDesktop';
import { DesktopRouteDrawer, type DrawerEntry } from './DesktopRouteDrawer';

interface OpenOptions {
    params?: Record<string, any>;
    title?: string;
}

interface DesktopRoutesContextValue {
    /** Open a registered route as a drawer on desktop, falls back to router.push otherwise. */
    open: (path: string, opts?: OpenOptions) => void;
    /** Pop the topmost drawer. */
    dismissTop: () => void;
    /** Close all drawers. */
    dismissAll: () => void;
    entries: DrawerEntry[];
}

const Ctx = React.createContext<DesktopRoutesContextValue | null>(null);

export function useDesktopRoutes(): DesktopRoutesContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('useDesktopRoutes must be used within DesktopRoutesProvider');
    return v;
}

export function DesktopRoutesProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [entries, setEntries] = React.useState<DrawerEntry[]>([]);

    const open = React.useCallback((path: string, opts?: OpenOptions) => {
        const desktop = isDesktopLayout(Dimensions.get('window').width);
        if (!desktop || !hasDesktopRoute(path)) {
            router.push(path as any);
            return;
        }
        const params = { ...parseQuery(path), ...(opts?.params ?? {}) };
        const cleanPath = path.split('?')[0];
        setEntries((prev) => [...prev, {
            id: `dr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            path: cleanPath,
            params,
            title: opts?.title,
        }]);
    }, [router]);

    const dismissTop = React.useCallback(() => {
        setEntries((prev) => prev.slice(0, -1));
    }, []);

    const dismissAll = React.useCallback(() => {
        setEntries([]);
    }, []);

    const value = React.useMemo(() => ({ open, dismissTop, dismissAll, entries }), [open, dismissTop, dismissAll, entries]);

    return (
        <Ctx.Provider value={value}>
            {children}
            {entries.map((entry, i) => (
                <DesktopRouteDrawer
                    key={entry.id}
                    entry={entry}
                    depth={i}
                    isTop={i === entries.length - 1}
                    onDismiss={() => setEntries((prev) => prev.filter((e) => e.id !== entry.id))}
                />
            ))}
        </Ctx.Provider>
    );
}
