import { buildBugTitle } from '@/sync/bugTypes';

export function getBugCreatePreviewTitle(description: string, fallbackTitle: string): string {
    const trimmed = description.trim();
    if (!trimmed) return fallbackTitle;
    return buildBugTitle(trimmed);
}

export function getBugCreateImageCountLabel(imageCount: number, maxImages: number): string {
    const safeMax = Math.max(0, maxImages);
    const safeCount = Math.min(Math.max(0, imageCount), safeMax);
    return `${safeCount}/${safeMax}`;
}

export function getBugCreateRemainingImageSlots(imageCount: number, maxImages: number): number {
    return Math.max(0, maxImages - imageCount);
}

export function isBugCreateSubmitEnabled(description: string, submitting: boolean): boolean {
    return description.trim().length > 0 && !submitting;
}

export function shouldShowBugCreateEmptyHint(description: string, imageCount: number): boolean {
    return description.trim().length === 0 && imageCount <= 0;
}
