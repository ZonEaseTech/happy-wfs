import { z } from 'zod';

/**
 * Feishu (Lark) custom-bot webhook configuration.
 *
 * The secret is the bot's signing key, not user content — it is stored
 * server-side in plaintext and never returned in GET responses.
 */
export const FeishuWebhookConfigSchema = z.object({
    url: z.string().url(),
    secret: z.string().optional(),
    enabled: z.boolean(),
});
export type FeishuWebhookConfig = z.infer<typeof FeishuWebhookConfigSchema>;

/**
 * Public-facing view returned to clients on GET. Hides the secret value.
 */
export const FeishuWebhookConfigPublicSchema = z.object({
    url: z.string().nullable(),
    secret_set: z.boolean(),
    enabled: z.boolean(),
    lastTestedAt: z.number().nullable(),
});
export type FeishuWebhookConfigPublic = z.infer<typeof FeishuWebhookConfigPublicSchema>;

/**
 * Top-level notification config persisted on Account.notificationConfig.
 * Object shape leaves room for additional channels (dingtalk, slack...) without
 * a Prisma migration each time.
 */
export const NotificationConfigSchema = z.object({
    feishu: FeishuWebhookConfigSchema.extend({
        lastTestedAt: z.number().optional(),
    }).optional(),
    feishuMention: FeishuWebhookConfigSchema.extend({
        lastTestedAt: z.number().optional(),
    }).optional(),
    /**
     * The account owner's own Feishu identity (open_id `ou_…` or tenant
     * user_id). When set, collaboration @ notifications sent to any owner's
     * mention webhook render this user as a real `<at>` ping instead of
     * plain text. The ping only fires if the user is in the bot's group.
     */
    feishuUserId: z.string().optional(),
});
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
