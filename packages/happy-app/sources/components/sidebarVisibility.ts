/**
 * The bug board doubles as a company-shared page, so it renders standalone
 * without the personal sessions sidebar.
 */
export function isSidebarHiddenPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return pathname === '/bug' || pathname.startsWith('/bug/');
}
