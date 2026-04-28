import * as React from 'react';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import {
    machineForkClaudeSession,
    machineForkGeminiSession,
    machineForkCodexSession,
    machineSpawnNewSession,
} from '@/sync/ops';
import { sync } from '@/sync/sync';
import {
    getSessionName,
    generateCopyTitle,
    copySessionMetadata,
    copySessionModeSettings,
} from '@/utils/sessionUtils';
import { Modal } from '@/modal';
import { t } from '@/text';

interface UseResumeSessionResult {
    handleResume: () => Promise<void>;
    isResuming: boolean;
}

/**
 * Fork an existing session's history into a new one and spawn it on the same
 * machine. Mirrors the "resume" flow that lived inline in info.tsx so the
 * session view can offer the same action without duplicating ~80 lines.
 *
 * Behavior:
 * - Active session  → "copy" (titled with " (copy)" suffix), no destructive prompt.
 * - Archived session → "resume" (keeps original title).
 *
 * Both paths require an explicit `intent: 'resume'` to the daemon (>=0.3.3),
 * otherwise resumeSessionId is silently dropped and the new session starts empty.
 */
export function useResumeSession(session: Session): UseResumeSessionResult {
    const router = useRouter();
    const [isResuming, setIsResuming] = React.useState(false);

    const handleResume = useCallback(async () => {
        if (isResuming) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const machineId = session.metadata?.machineId;
        const directory = session.metadata?.path;

        const hasForkableId = claudeSessionId || flavor === 'gemini' || codexSessionId;
        if (!hasForkableId || !directory || !machineId) return;

        const isOnline = session.active;
        const provider = flavor === 'gemini' ? 'Gemini' : flavor === 'codex' ? 'Codex' : 'Claude';
        const confirmTitle = isOnline ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle');
        const confirmMessage = isOnline ? t('sessionHistory.copyConfirmMessage', { provider }) : t('sessionHistory.resumeConfirmMessage', { provider });
        const confirmed = await Modal.confirm(confirmTitle, confirmMessage, {
            confirmText: t('common.continue'),
            cancelText: t('common.cancel'),
        });
        if (!confirmed) return;

        setIsResuming(true);
        try {
            const originalTitle = session.metadata?.summary?.text || getSessionName(session);
            const sessionTitle = isOnline ? generateCopyTitle(originalTitle) : originalTitle;

            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' = 'claude';

            if (flavor === 'gemini') {
                const forkResult = await machineForkGeminiSession(machineId, session.id);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const forkResult = await machineForkCodexSession(machineId, codexSessionId);
                if (!forkResult.success || !forkResult.newFilePath) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const forkResult = await machineForkClaudeSession(machineId, claudeSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'claude';
            } else {
                return;
            }

            const result = await machineSpawnNewSession({
                machineId,
                directory,
                approvedNewDirectoryCreation: false,
                agent,
                resumeSessionId,
                intent: 'resume',
                sessionTitle,
                skipForkSession: true,
            });
            if (result.type === 'requestToApproveDirectoryCreation') {
                Modal.alert(t('common.error'), t('claudeHistory.directoryNotFound'));
                return;
            }
            if (result.type === 'error') {
                Modal.alert(t('common.error'), result.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            if (result.type === 'success') {
                await sync.refreshSessions();
                await copySessionMetadata(session, result.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
                copySessionModeSettings(session, result.sessionId);
                router.push(`/session/${result.sessionId}`);
            }
        } catch (error) {
            console.error('Failed to resume session', error);
            Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
        } finally {
            setIsResuming(false);
        }
    }, [session, isResuming, router]);

    return { handleResume, isResuming };
}
