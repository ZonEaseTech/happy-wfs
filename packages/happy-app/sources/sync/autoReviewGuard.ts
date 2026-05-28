import { sessionUpdateMetadataFields } from '@/sync/ops';
import { getSession, useSession } from '@/sync/storage';
import type { Metadata } from '@/sync/storageTypes';
import type { AutoReviewGuardSettings } from './settings';
import { autoReviewGuardSettingsDefaults } from './settings';

export type AutoReviewGuard = NonNullable<Metadata['autoReviewGuard']>;

export type AutoReviewGuardEditableSettings = Pick<AutoReviewGuard,
    'delayMs' | 'triggerPhrases' | 'reviewPrompt' | 'followUpTemplate' | 'sendSimplifyOnPass'
>;

export function normalizeAutoReviewGuardSettings(value?: Partial<AutoReviewGuardEditableSettings> | null): AutoReviewGuardSettings {
    const triggerPhrases = Array.isArray(value?.triggerPhrases)
        ? value.triggerPhrases.map((item) => item.trim()).filter(Boolean)
        : autoReviewGuardSettingsDefaults.triggerPhrases;

    return {
        ...autoReviewGuardSettingsDefaults,
        delayMs: typeof value?.delayMs === 'number' && Number.isFinite(value.delayMs)
            ? Math.max(0, Math.min(300_000, Math.round(value.delayMs)))
            : autoReviewGuardSettingsDefaults.delayMs,
        triggerPhrases: triggerPhrases.length > 0 ? triggerPhrases : autoReviewGuardSettingsDefaults.triggerPhrases,
        reviewPrompt: typeof value?.reviewPrompt === 'string' && value.reviewPrompt.trim()
            ? value.reviewPrompt.trim()
            : autoReviewGuardSettingsDefaults.reviewPrompt,
        followUpTemplate: typeof value?.followUpTemplate === 'string' && value.followUpTemplate.trim()
            ? value.followUpTemplate.trim()
            : autoReviewGuardSettingsDefaults.followUpTemplate,
        sendSimplifyOnPass: typeof value?.sendSimplifyOnPass === 'boolean'
            ? value.sendSimplifyOnPass
            : autoReviewGuardSettingsDefaults.sendSimplifyOnPass,
        enabled: false,
    };
}

export function buildNextAutoReviewGuard(
    current: AutoReviewGuard | undefined,
    now = Date.now(),
    defaults?: Partial<AutoReviewGuardEditableSettings>,
): AutoReviewGuard {
    if (current?.enabled) {
        return {
            ...current,
            enabled: false,
            status: 'idle',
            updatedAt: now,
        };
    }

    const settings = normalizeAutoReviewGuardSettings({ ...defaults, ...current });
    return {
        ...current,
        enabled: true,
        status: current?.status && current.status !== 'needs_follow_up' ? current.status : 'idle',
        updatedAt: now,
        delayMs: settings.delayMs,
        triggerPhrases: settings.triggerPhrases,
        reviewPrompt: settings.reviewPrompt,
        followUpTemplate: settings.followUpTemplate,
        sendSimplifyOnPass: settings.sendSimplifyOnPass,
        simplifyPending: false,
    };
}

export function useAutoReviewGuard(sessionId: string): AutoReviewGuard | undefined {
    return useSession(sessionId)?.metadata?.autoReviewGuard;
}

export async function saveAutoReviewGuard(sessionId: string, guard: AutoReviewGuard): Promise<AutoReviewGuard | undefined> {
    const session = getSession(sessionId);
    if (!session?.metadata) return undefined;

    await sessionUpdateMetadataFields(
        sessionId,
        session.metadata,
        { autoReviewGuard: guard },
        session.metadataVersion,
    );
    return guard;
}

export async function toggleAutoReviewGuard(
    sessionId: string,
    defaults?: Partial<AutoReviewGuardEditableSettings>,
): Promise<AutoReviewGuard | undefined> {
    const session = getSession(sessionId);
    if (!session?.metadata) return undefined;

    const next = buildNextAutoReviewGuard(session.metadata.autoReviewGuard, Date.now(), defaults);
    return saveAutoReviewGuard(sessionId, next);
}
