import { Platform, useWindowDimensions } from 'react-native';

const DESKTOP_BREAKPOINT = 768;

/** Desktop = web + viewport >= 768px. Native phones/tablets always return false. */
export function isDesktopLayout(width?: number): boolean {
    if (Platform.OS !== 'web') return false;
    const w = width ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
    return w >= DESKTOP_BREAKPOINT;
}

export function useIsDesktop(): boolean {
    const { width } = useWindowDimensions();
    return isDesktopLayout(width);
}
