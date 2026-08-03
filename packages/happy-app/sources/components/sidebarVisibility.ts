/**
 * Pages that double as public/company-shared destinations render standalone
 * without the personal sessions sidebar: the bug board and share viewers.
 */
export function isSidebarHiddenPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return pathname === '/bug' || pathname.startsWith('/bug/')
        || pathname === '/share/html' || pathname.startsWith('/share/s/');
}
