/**
 * Simple module-level store for passing HTML content to the preview route.
 * HTML can be very large, so we use a module variable instead of URL params.
 */
let _pendingHtml: string | null = null;
let _pendingTitle: string | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

export function setPreviewHtml(html: string, title: string | null) {
    _pendingHtml = html;
    _pendingTitle = title;
    _version++;
    _listeners.forEach((listener) => listener());
}

export function subscribePreviewHtml(listener: () => void): () => void {
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
}

export function getPreviewHtmlVersion(): number {
    return _version;
}

export function consumePreviewHtml(): { html: string | null; title: string | null } {
    const result = { html: _pendingHtml, title: _pendingTitle };
    _pendingHtml = null;
    _pendingTitle = null;
    return result;
}

/** Non-consuming read for the right-panel preview, which re-renders freely. */
export function peekPreviewHtml(): { html: string | null; title: string | null } {
    return { html: _pendingHtml, title: _pendingTitle };
}

/**
 * Desktop panel hook-up: SessionView registers an opener while in desktop
 * panel mode so preview cards open beside the chat instead of navigating
 * away (which would hide the terminal/right panel).
 */
let _panelOpener: (() => void) | null = null;

export function registerPreviewPanelOpener(opener: (() => void) | null) {
    _panelOpener = opener;
}

export function openPreviewInPanel(): boolean {
    if (!_panelOpener) return false;
    _panelOpener();
    return true;
}
