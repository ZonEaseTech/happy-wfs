import * as React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import { storage } from '@/sync/storage';
import { sessionKill } from '@/sync/ops';
import { cleanupWorktree, cleanupWorkspace } from '@/utils/worktreeOps';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { t } from '@/text';

interface UseArchiveSessionOptions {
    /** Override default post-archive navigation. If omitted, replaces to "/" (web)
     *  or pops back twice (native). */
    onArchived?: () => void;
}

interface UseArchiveSessionResult {
    handleArchive: () => void;
    isArchiving: boolean;
    /** Must be rendered in the consumer's tree so the worktree action menu can appear. */
    archiveOverlay: React.ReactNode;
}

/**
 * Archive a session with worktree-aware cleanup options.
 *
 * Plain session  → simple confirm dialog
 * Worktree       → 3-option menu (keep / cleanup keep branch / cleanup + delete branch)
 * Multi-repo     → same menu, scoped to the whole workspace
 */
export function useArchiveSession(session: Session, options: UseArchiveSessionOptions = {}): UseArchiveSessionResult {
    const router = useRouter();
    const onArchived = options.onArchived;

    const navigateAfterArchive = React.useCallback(() => {
        if (onArchived) {
            onArchived();
            return;
        }
        if (Platform.OS === 'web') {
            router.replace('/');
        } else {
            router.back();
            router.back();
        }
    }, [router, onArchived]);

    const [isArchiving, performArchive] = useHappyAction(async () => {
        const previousActive = storage.getState().sessions[session.id]?.active ?? session.active;
        storage.getState().updateSessionActivity(session.id, false);

        const result = await sessionKill(session.id);
        const errorMessage = result.message || t('sessionInfo.failedToArchiveSession');

        // Idempotent: if the agent process is gone, the session is effectively archived already.
        if (!result.success && /RPC method not available/i.test(errorMessage)) {
            navigateAfterArchive();
            return;
        }

        if (!result.success) {
            storage.getState().updateSessionActivity(session.id, previousActive);
            throw new HappyError(errorMessage, false);
        }

        navigateAfterArchive();
    });

    const workspaceRepos = React.useMemo(() => getWorkspaceRepos(session.metadata), [session.metadata]);
    const isWorktree = workspaceRepos.length > 0;
    const isMultiRepo = workspaceRepos.length > 1;
    const worktreeMachineId = session.metadata?.machineId;
    const selectedRepo = workspaceRepos[0];
    const worktreeBasePath = selectedRepo?.basePath;
    const worktreeBranch = selectedRepo?.branchName;

    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    const handleArchive = React.useCallback(() => {
        if (isWorktree && worktreeMachineId) {
            const machineId = worktreeMachineId;
            setArchiveMenuItems([
                {
                    label: t('sessionInfo.worktree.archiveKeepWorktree'),
                    onPress: () => { setArchiveMenuVisible(false); performArchive(); },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupKeepBranch'),
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try {
                            if (isMultiRepo && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, false);
                            } else if (worktreeBasePath && worktreeBranch) {
                                await cleanupWorktree(machineId, worktreeBasePath, worktreeBranch, false);
                            }
                        } catch (e) { console.warn('Worktree cleanup failed:', e); }
                        await performArchive();
                    },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'),
                    destructive: true,
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try {
                            if (isMultiRepo && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, true);
                            } else if (worktreeBasePath && worktreeBranch) {
                                await cleanupWorktree(machineId, worktreeBasePath, worktreeBranch, true);
                            }
                        } catch (e) { console.warn('Worktree cleanup failed:', e); }
                        await performArchive();
                    },
                },
            ]);
            setArchiveMenuVisible(true);
        } else {
            Modal.alert(
                t('sessionInfo.archiveSession'),
                t('sessionInfo.archiveSessionConfirm'),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('sessionInfo.archiveSession'),
                        style: 'destructive',
                        onPress: performArchive,
                    },
                ],
            );
        }
    }, [performArchive, session.metadata, isWorktree, isMultiRepo, worktreeMachineId, worktreeBasePath, worktreeBranch, workspaceRepos]);

    const archiveOverlay = (
        <ActionMenuModal
            visible={archiveMenuVisible}
            title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
            items={archiveMenuItems}
            onClose={() => setArchiveMenuVisible(false)}
        />
    );

    return { handleArchive, isArchiving, archiveOverlay };
}
