import { z } from 'zod';

/**
 * User memory — content the user wants Claude to remember across all
 * sessions. happy-cli pulls these on session start and injects them into the
 * system prompt as a `<user_memory>` block.
 */
export const MemorySourceSchema = z.enum(['manual', 'message-pin']);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const MemorySchema = z.object({
    id: z.string(),
    content: z.string().min(1).max(8000),
    source: MemorySourceSchema,
    sourceSessionId: z.string().nullable(),
    sourceMessageId: z.string().nullable(),
    archivedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const CreateMemoryRequestSchema = z.object({
    content: z.string().min(1).max(8000),
    source: MemorySourceSchema.optional().default('manual'),
    sourceSessionId: z.string().optional(),
    sourceMessageId: z.string().optional(),
});
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>;

export const UpdateMemoryRequestSchema = z.object({
    content: z.string().min(1).max(8000),
});
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>;
