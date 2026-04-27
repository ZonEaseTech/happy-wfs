import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

interface DesktopRouteContextValue {
    isInDrawer: boolean;
    params: Record<string, any>;
    dismiss: () => void;
    /** Drawer-only: register a node to be rendered in the drawer's header right slot. */
    setHeaderRight?: (node: React.ReactNode) => void;
}

export const DesktopRouteContext = React.createContext<DesktopRouteContextValue>({
    isInDrawer: false,
    params: {},
    dismiss: () => {},
});

/**
 * Polymorphic route hook. In a desktop drawer returns the drawer's context;
 * on a real expo-router screen returns router-driven equivalents.
 */
export function useDesktopRoute(): DesktopRouteContextValue {
    const ctx = React.useContext(DesktopRouteContext);
    const router = useRouter();
    if (ctx.isInDrawer) return ctx;
    return {
        isInDrawer: false,
        params: {},
        dismiss: () => router.back(),
    };
}

/**
 * Polymorphic params reader: drawer ctx params if drawer-rendered,
 * else expo-router useLocalSearchParams.
 */
export function useRouteParams<T extends Record<string, any> = Record<string, any>>(): T {
    const ctx = React.useContext(DesktopRouteContext);
    const routerParams = useLocalSearchParams();
    return (ctx.isInDrawer ? ctx.params : routerParams) as T;
}

/**
 * Inject a header-right node into the drawer header (drawer mode only).
 * Pass `null` to clear. Re-runs whenever `node` reference changes.
 *
 * In route mode this is a no-op — the page's <Stack.Screen options.headerRight>
 * still controls the native header.
 */
export function useDrawerHeaderRight(node: React.ReactNode): void {
    const ctx = React.useContext(DesktopRouteContext);
    React.useEffect(() => {
        if (!ctx.isInDrawer || !ctx.setHeaderRight) return;
        ctx.setHeaderRight(node);
        return () => { ctx.setHeaderRight?.(null); };
    }, [ctx, node]);
}
