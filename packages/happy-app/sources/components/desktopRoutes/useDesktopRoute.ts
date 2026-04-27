import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

interface DesktopRouteContextValue {
    isInDrawer: boolean;
    params: Record<string, any>;
    dismiss: () => void;
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
