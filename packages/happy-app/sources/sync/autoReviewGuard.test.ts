import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/ops', () => ({
    sessionUpdateMetadataFields: vi.fn(),
}));

vi.mock('@/sync/storage', () => ({
    getSession: vi.fn(),
    useSession: vi.fn(),
}));

import { buildNextAutoReviewGuard } from './autoReviewGuard';
import { autoReviewGuardSettingsDefaults } from './settings';

describe('buildNextAutoReviewGuard', () => {
    it('enables an empty guard as idle', () => {
        const next = buildNextAutoReviewGuard(undefined, 1000);
        expect(next).toEqual({
            enabled: true,
            status: 'idle',
            updatedAt: 1000,
            delayMs: autoReviewGuardSettingsDefaults.delayMs,
            triggerPhrases: autoReviewGuardSettingsDefaults.triggerPhrases,
            reviewPrompt: autoReviewGuardSettingsDefaults.reviewPrompt,
            followUpTemplate: autoReviewGuardSettingsDefaults.followUpTemplate,
            sendSimplifyOnPass: autoReviewGuardSettingsDefaults.sendSimplifyOnPass,
            simplifyPending: false,
        });
    });

    it('disables an enabled guard while preserving last review details', () => {
        const next = buildNextAutoReviewGuard({
            enabled: true,
            status: 'passed',
            updatedAt: 900,
            lastSummary: 'ok',
            lastReviewFingerprint: 'abc',
        }, 1000);
        expect(next).toEqual({
            enabled: false,
            status: 'idle',
            updatedAt: 1000,
            lastSummary: 'ok',
            lastReviewFingerprint: 'abc',
        });
    });
});
