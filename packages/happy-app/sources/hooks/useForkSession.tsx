import * as React from 'react';
import { useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import { Modal } from '@/modal';
import {
    machineForkClaudeSession,
    machineForkGeminiSession,
    machineForkCodexSession,
    machineSpawnNewSession,
} from '@/sync/ops';
import { sync } from '@/sync/sync';
import { generateCopyTitle, getSessionName, copySessionMetadata, copySessionModeSettings } from '@/utils/sessionUtils';
import { t } from '@/text';

interface UseForkSessionResult {
    /** Trigger fork+spawn. Behavior switches by `session.active`:
     *  - active   → "copy" (new session with auto-incremented title)
     *  - archived → "resume" (new session keeping original title)
     */
    handleFork: () => Promise<void>;
    isForking: boolean;
    /** True when this session has the data needed to be forkable (claude/codex/gemini id + machine + path). */
    canFork: boolean;
}

/**
 * Spawn a new session that resumes (or copies) the current one.
 *
 * Lives as a hook so info.tsx and SessionView's toolbar share one
 * source of truth — same confirm dialogs, same spawn semantics.
 */
export function useForkSession(session: Session): UseForkSessionResult {
    const router = useRouter();
    const [isForking, setIsForking] = React.useState(false);

    const flavor = session.metadata?.flavor;
    const claudeSessionId = session.metadata?.claudeSessionId;
    const codexSessionId = session.metadata?.codexSessionId;
    const machineId = session.metadata?.machineId;
    const directory = session.metadata?.path;
    const canFork = !!((claudeSessionId || flavor === 'gemini' || codexSessionId) && directory && machineId);

    const handleFork = React.useCallback(async () => {
        if (isForking) return;
        if (!canFork || !machineId || !directory) return;

        const isOnline = session.active;
        const provider = flavor === 'gemini' ? 'Gemini' : flavor === 'codex' ? 'Codex' : 'Claude';
        const confirmTitle = isOnline ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle');
        const confirmMessage = isOnline ? t('sessionHistory.copyConfirmMessage', { provider }) : t('sessionHistory.resumeConfirmMessage', { provider });
        const confirmed = await Modal.confirm(confirmTitle, confirmMessage, {
            confirmText: t('common.continue'),
            cancelText: t('common.cancel'),
        });
        if (!confirmed) return;

        setIsForking(true);
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
            console.error('Failed to fork session', error);
            Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
        } finally {
            setIsForking(false);
        }
    }, [session, isForking, canFork, machineId, directory, flavor, claudeSessionId, codexSessionId, router]);

    return { handleFork, isForking, canFork };
}
