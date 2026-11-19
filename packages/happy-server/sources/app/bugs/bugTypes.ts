import { z } from 'zod';

export const BUG_STATUSES = ['pending', 'in_progress', 'verify', 'closed'] as const;
export const BUG_VISIBILITIES = ['shared', 'private'] as const;
export const BUG_IMAGE_LIMITS = {
    maxImages: 10,
    maxSizeBytes: 20 * 1024 * 1024,
} as const;

export const BugStatusSchema = z.enum(BUG_STATUSES);
export const BugVisibilitySchema = z.enum(BUG_VISIBILITIES);

export type BugStatus = z.infer<typeof BugStatusSchema>;
export type BugVisibility = z.infer<typeof BugVisibilitySchema>;
export type BugActor = { userId?: string; nickname: string };

export const BUG_PROJECT_MAX_LENGTH = 40;

/**
 * A bug's project is a free-text product name ("TTPOS", "lite-pos") that the
 * board groups by. Whitespace is collapsed so " TTPOS " and "TTPOS" land in
 * the same group; blank means the bug has no project.
 */
export function normalizeBugProject(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim().slice(0, BUG_PROJECT_MAX_LENGTH).trim();
    return normalized || null;
}
