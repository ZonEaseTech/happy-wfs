/**
 * Simple module-level store for passing HTML content to the preview route.
 * HTML can be very large, so we use a module variable instead of URL params.
 */
let _pendingHtml: string | null = null;
let _pendingTitle: string | null = null;
export function setPreviewHtml(html: string, title: string | null) {
    _pendingHtml = html;
    _pendingTitle = title;
}

export function consumePreviewHtml(): { html: string | null; title: string | null } {
    const result = { html: _pendingHtml, title: _pendingTitle };
    _pendingHtml = null;
    _pendingTitle = null;
    return result;
}

/**
 * Desktop panel hook-up: SessionView registers an opener while in desktop
 * panel mode so tool cards (preview html) open inside the chat column via
 * ChatToolOverlay instead of navigating away and hiding the terminal.
 */
let _toolPanelOpener: ((messageId: string) => void) | null = null;

export function registerToolPanelOpener(opener: ((messageId: string) => void) | null) {
    _toolPanelOpener = opener;
}

export function openToolInPanel(messageId: string): boolean {
    if (!_toolPanelOpener) return false;
    _toolPanelOpener(messageId);
    return true;
}
