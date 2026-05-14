import * as z from 'zod';

//
// Schema
//

export const CustomQuickActionSchema = z.object({
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    prompt: z.string().trim().min(1),
    icon: z.string().trim().optional(),
});

export type CustomQuickAction = z.infer<typeof CustomQuickActionSchema>;

export const LocalSettingsSchema = z.object({
    // Developer settings (device-specific)
    debugMode: z.boolean().describe('Enable debug logging'),
    devModeEnabled: z.boolean().describe('Enable developer menu in settings'),
    commandPaletteEnabled: z.boolean().describe('Enable CMD+K command palette (web only)'),
    themePreference: z.enum(['light', 'dark', 'adaptive']).describe('Theme preference: light, dark, or adaptive (follows system)'),
    markdownCopyV2: z.boolean().describe('Replace native paragraph selection with long-press modal for full markdown copy'),
    hideNotificationsWhenActive: z.boolean().describe('Hide all notifications while the app is active'),
    hideSessionNotificationsWhenActive: z.boolean().describe('Hide notifications for the currently open session while the app is active'),
    // Worktree branch naming - prefix prepended to auto-generated branch names (e.g. "vk/" -> "vk/clever-ocean")
    worktreeBranchPrefix: z.string().describe('Prefix prepended to auto-generated worktree branch names (e.g. "vk/")'),
    // CLI version acknowledgments - keyed by machineId
    acknowledgedCliVersions: z.record(z.string(), z.string()).describe('Acknowledged CLI versions per machine'),
    customQuickActions: z.array(CustomQuickActionSchema).describe('Device-local AI shortcut prompts shown in the web session composer'),
    githubIssueInboxFilters: z.object({
        /**
         * Comma/newline separated keywords. A GitHub issue is shown when any
         * keyword matches its title, repo, labels, project title, or project
         * Status value (e.g. "Todo").
         */
        keywords: z.string(),
        /**
         * Comma/newline separated GitHub project titles. A GitHub issue is
         * shown only when it belongs to at least one matching project.
         */
        projects: z.string().optional(),
    }).describe('Device-local filters for the GitHub issue inbox'),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
    debugMode: false,
    devModeEnabled: false,
    commandPaletteEnabled: false,
    themePreference: 'adaptive',
    markdownCopyV2: true,
    hideNotificationsWhenActive: false,
    hideSessionNotificationsWhenActive: false,
    worktreeBranchPrefix: '',
    acknowledgedCliVersions: {},
    customQuickActions: [],
    githubIssueInboxFilters: { keywords: '', projects: '' },
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
    const parsed = LocalSettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        return { ...localSettingsDefaults };
    }
    return { ...localSettingsDefaults, ...parsed.data };
}

//
// Applying changes
//

export function applyLocalSettings(settings: LocalSettings, delta: Partial<LocalSettings>): LocalSettings {
    return { ...localSettingsDefaults, ...settings, ...delta };
}
