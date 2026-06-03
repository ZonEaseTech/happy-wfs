/**
 * Central registry of desktop drawer routes.
 * Imported by DesktopRoutesProvider so all routes are registered at app startup.
 * Loaders themselves remain lazy (only invoked when a drawer is opened).
 */
import { registerDesktopRoute } from './registry';

/** Title key (i18n path) for each registered route — used by deep-link redirector. */
export const DESKTOP_ROUTE_TITLES: Record<string, string> = {
    '/memory': 'memory.title',
    '/settings/worktree-config': 'worktreeConfig.title',
    '/settings/account': 'settings.account',
    '/settings/appearance': 'settings.appearance',
    '/settings/claude-config': 'claudeConfig.title',
    '/settings/features': 'settings.features',
    '/settings/github-issue-start-template': 'settingsFeatures.githubIssueStartPromptTemplate',
    '/settings/language': 'settingsLanguage.title',
    '/settings/notifications': 'settingsNotifications.title',
    '/settings/notifications-feishu': 'settings.feishuNotification',
    '/settings/profile-edit': 'profiles.editProfile',
    '/settings/profiles': 'settings.profiles',
    '/settings/usage': 'settings.usage',
    '/settings/voice': 'settings.voiceAssistant',
    '/settings/voice/elevenlabs': 'settingsVoice.elevenLabsTitle',
    '/settings/voice/happy-voice': 'settingsVoice.happyVoiceTitle',
    '/settings/voice/welcome-message': 'settingsVoice.welcomeMessage',
    '/settings/voice/language': 'settingsVoice.preferredLanguage',
};

registerDesktopRoute('/memory', () => import('@/app/(app)/memory'));
registerDesktopRoute('/settings/worktree-config', () => import('@/app/(app)/settings/worktree-config'));
registerDesktopRoute('/settings/account', () => import('@/app/(app)/settings/account'));
registerDesktopRoute('/settings/appearance', () => import('@/app/(app)/settings/appearance'));
registerDesktopRoute('/settings/claude-config', () => import('@/app/(app)/settings/claude-config'));
registerDesktopRoute('/settings/features', () => import('@/app/(app)/settings/features'));
registerDesktopRoute('/settings/github-issue-start-template', () => import('@/app/(app)/settings/github-issue-start-template'));
registerDesktopRoute('/settings/language', () => import('@/app/(app)/settings/language'));
registerDesktopRoute('/settings/notifications', () => import('@/app/(app)/settings/notifications'));
registerDesktopRoute('/settings/notifications-feishu', () => import('@/app/(app)/settings/notifications-feishu'));
registerDesktopRoute('/settings/profile-edit', () => import('@/app/(app)/settings/profile-edit'));
registerDesktopRoute('/settings/profiles', () => import('@/app/(app)/settings/profiles'));
registerDesktopRoute('/settings/usage', () => import('@/app/(app)/settings/usage'));
registerDesktopRoute('/settings/voice', () => import('@/app/(app)/settings/voice'));
registerDesktopRoute('/settings/voice/elevenlabs', () => import('@/app/(app)/settings/voice/elevenlabs'));
registerDesktopRoute('/settings/voice/happy-voice', () => import('@/app/(app)/settings/voice/happy-voice'));
registerDesktopRoute('/settings/voice/welcome-message', () => import('@/app/(app)/settings/voice/welcome-message'));
registerDesktopRoute('/settings/voice/language', () => import('@/app/(app)/settings/voice/language'));
