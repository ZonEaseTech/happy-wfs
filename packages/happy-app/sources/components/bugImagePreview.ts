import type { BugAttachment } from '@/sync/bugTypes';

export type BugPreviewImage = {
    id: string;
    uri: string;
};

export type BugPreviewZoomState = {
    scale: number;
    translateX: number;
    translateY: number;
};

export const BUG_PREVIEW_MIN_ZOOM = 1;
export const BUG_PREVIEW_MAX_ZOOM = 4;
export const BUG_PREVIEW_ZOOM_STEP = 0.5;

type BugPreviewSource = {
    attachments: BugAttachment[];
    comments: Array<{ attachments: BugAttachment[] }>;
};

export function buildBugPreviewImages<TSource extends BugPreviewSource>(source: TSource): BugPreviewImage[] {
    return [
        ...source.attachments.map(attachment => ({ id: attachment.id, uri: attachment.url })),
        ...source.comments.flatMap(comment => comment.attachments.map(attachment => ({ id: attachment.id, uri: attachment.url }))),
    ];
}

export function findBugPreviewImageIndex(images: BugPreviewImage[], uri: string): number {
    const index = images.findIndex(image => image.uri === uri);
    return index >= 0 ? index : 0;
}

export function clampBugPreviewZoom(scale: number): number {
    if (!Number.isFinite(scale)) return BUG_PREVIEW_MIN_ZOOM;
    const clamped = Math.min(BUG_PREVIEW_MAX_ZOOM, Math.max(BUG_PREVIEW_MIN_ZOOM, scale));
    return Math.round(clamped * 100) / 100;
}

export function getNextBugPreviewZoom(scale: number, direction: -1 | 1): number {
    return clampBugPreviewZoom(scale + direction * BUG_PREVIEW_ZOOM_STEP);
}

export function getToggledBugPreviewZoom(scale: number): number {
    return scale > BUG_PREVIEW_MIN_ZOOM ? BUG_PREVIEW_MIN_ZOOM : 2;
}

export function resetBugPreviewZoomState(): BugPreviewZoomState {
    return { scale: BUG_PREVIEW_MIN_ZOOM, translateX: 0, translateY: 0 };
}

export function clampBugPreviewPan(value: number, scale: number, viewportSize: number): number {
    if (scale <= BUG_PREVIEW_MIN_ZOOM || viewportSize <= 0 || !Number.isFinite(value)) return 0;
    const maxOffset = viewportSize * (scale - 1) / 2;
    return Math.min(maxOffset, Math.max(-maxOffset, value));
}

export function shouldEnableBugPreviewZoom(platformOS: string): boolean {
    return platformOS === 'web';
}

export function getBugPreviewWheelZoomDirection(deltaY: number): -1 | 0 | 1 {
    if (deltaY < 0) return 1;
    if (deltaY > 0) return -1;
    return 0;
}
