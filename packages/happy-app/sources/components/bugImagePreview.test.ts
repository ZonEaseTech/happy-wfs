import { describe, expect, it } from 'vitest';
import {
    BUG_PREVIEW_MAX_ZOOM,
    BUG_PREVIEW_MIN_ZOOM,
    buildBugPreviewImages,
    clampBugPreviewPan,
    clampBugPreviewZoom,
    findBugPreviewImageIndex,
    getBugPreviewWheelZoomDirection,
    getNextBugPreviewZoom,
    getToggledBugPreviewZoom,
    resetBugPreviewZoomState,
    shouldEnableBugPreviewZoom,
} from './bugImagePreview';

const attachment = (id: string, url: string) => ({
    id,
    url,
    mimeType: 'image/png',
    sizeBytes: 100,
    width: 800,
    height: 600,
    thumbhash: null,
    uploadedByNickname: '测试李',
    createdAt: 1,
});

describe('bug image preview', () => {
    it('combines description and comment images into one preview list', () => {
        const images = buildBugPreviewImages({
            attachments: [attachment('a1', 'https://example.test/desc-1.png')],
            comments: [
                { id: 'c1', body: '补充', authorNickname: '王五', createdAt: 2, attachments: [attachment('a2', 'https://example.test/comment-1.png')] },
            ],
        });

        expect(images).toEqual([
            { id: 'a1', uri: 'https://example.test/desc-1.png' },
            { id: 'a2', uri: 'https://example.test/comment-1.png' },
        ]);
    });

    it('opens the clicked image index from the unified preview list', () => {
        const images = [
            { id: 'a1', uri: 'https://example.test/desc-1.png' },
            { id: 'a2', uri: 'https://example.test/comment-1.png' },
        ];

        expect(findBugPreviewImageIndex(images, 'https://example.test/comment-1.png')).toBe(1);
        expect(findBugPreviewImageIndex(images, 'missing')).toBe(0);
    });

    it('clamps preview zoom between 1x and 4x', () => {
        expect(clampBugPreviewZoom(0.5)).toBe(BUG_PREVIEW_MIN_ZOOM);
        expect(clampBugPreviewZoom(2.25)).toBe(2.25);
        expect(clampBugPreviewZoom(4.5)).toBe(BUG_PREVIEW_MAX_ZOOM);
    });

    it('supports step zoom, double-click toggle, and reset state', () => {
        expect(getNextBugPreviewZoom(1, 1)).toBe(1.5);
        expect(getNextBugPreviewZoom(4, 1)).toBe(4);
        expect(getNextBugPreviewZoom(1, -1)).toBe(1);
        expect(getToggledBugPreviewZoom(1)).toBe(2);
        expect(getToggledBugPreviewZoom(2)).toBe(1);
        expect(resetBugPreviewZoomState()).toEqual({ scale: 1, translateX: 0, translateY: 0 });
    });

    it('allows panning only while zoomed and clamps movement to the zoomed image bounds', () => {
        expect(clampBugPreviewPan(80, 1, 300)).toBe(0);
        expect(clampBugPreviewPan(80, 2, 300)).toBe(80);
        expect(clampBugPreviewPan(260, 2, 300)).toBe(150);
        expect(clampBugPreviewPan(-260, 2, 300)).toBe(-150);
    });

    it('enables preview zoom only on PC web', () => {
        expect(shouldEnableBugPreviewZoom('web')).toBe(true);
        expect(shouldEnableBugPreviewZoom('ios')).toBe(false);
        expect(shouldEnableBugPreviewZoom('android')).toBe(false);
        expect(shouldEnableBugPreviewZoom('macos')).toBe(false);
    });

    it('maps mouse wheel direction to preview zoom direction', () => {
        expect(getBugPreviewWheelZoomDirection(-120)).toBe(1);
        expect(getBugPreviewWheelZoomDirection(120)).toBe(-1);
        expect(getBugPreviewWheelZoomDirection(0)).toBe(0);
    });
});
