/**
 * Locks the viewport breakpoint that picks the content column width.
 *
 * A wrong comparison or threshold still renders — it just puts a 1200 column on
 * a laptop, where it runs edge to edge against the sidebar. That is exactly the
 * regression this breakpoint exists to prevent, and nothing else would catch it.
 *
 * `layout` is evaluated at module load, so each viewport needs a fresh import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewportWidth = 0;

vi.mock('react-native', () => ({
    Dimensions: { get: () => ({ width: viewportWidth, height: 1000 }) },
    Platform: { OS: 'web' },
}));
vi.mock('@/utils/responsive', () => ({ getDeviceType: () => 'tablet' as const }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));

async function widthsAt(width: number): Promise<{ maxWidth: number; headerMaxWidth: number }> {
    viewportWidth = width;
    vi.resetModules();
    const { layout } = await import('./layout');
    return layout;
}

describe('content column width', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('keeps built-in Mac displays on the narrower column', async () => {
        expect((await widthsAt(1470)).maxWidth).toBe(1000); // MacBook Air 13"
        expect((await widthsAt(1512)).maxWidth).toBe(1000); // MacBook Pro 14"
        expect((await widthsAt(1728)).maxWidth).toBe(1000); // MacBook Pro 16"
    });

    it('widens once an external monitor gives the room', async () => {
        expect((await widthsAt(1920)).maxWidth).toBe(1200);
        expect((await widthsAt(2560)).maxWidth).toBe(1200);
    });

    it('switches exactly at the threshold', async () => {
        expect((await widthsAt(1799)).maxWidth).toBe(1000);
        expect((await widthsAt(1800)).maxWidth).toBe(1200);
    });

    it('keeps the header tracking the content column', async () => {
        const narrow = await widthsAt(1512);
        expect(narrow.headerMaxWidth).toBe(narrow.maxWidth);

        const wide = await widthsAt(1920);
        expect(wide.headerMaxWidth).toBe(wide.maxWidth);
    });
});
