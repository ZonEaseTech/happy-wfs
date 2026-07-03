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
