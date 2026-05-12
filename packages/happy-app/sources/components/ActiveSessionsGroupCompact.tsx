import React from 'react';
import { View, Pressable, Platform, ActivityIndicator, Animated, Modal as RNModal } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { router, useRouter } from 'expo-router';
import { Session, Machine } from '@/sync/storageTypes';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionAvatarId, formatPathRelativeToHome } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { useAllMachines, useSetting } from '@/sync/storage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession, sessionKill, sessionUpdateSummary } from '@/sync/ops';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useIsTablet } from '@/utils/responsive';
import { ProjectGitStatus } from './ProjectGitStatus';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { getWorktreeInfo, cleanupWorktree } from '@/utils/worktreeOps';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { useIsReviewPending, toggleReviewPending } from '@/sync/reviewPending';
import { useAwaitingClosureMarks, useIsAwaitingClosure, toggleAwaitingClosure } from '@/sync/awaitingClosure';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 8,
    },
    projectCard: {
        backgroundColor: theme.colors.surface,
        marginBottom: 8,
        marginHorizontal: Platform.select({ ios: 16, default: 12 }),
        borderRadius: Platform.select({ ios: 10, default: 16 }),
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 0.33 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 0,
        elevation: 1,
    },
    sectionHeader: {
        paddingTop: 12,
        paddingBottom: Platform.select({ ios: 6, default: 8 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    sectionHeaderAvatar: {
        marginRight: 8,
    },
    sectionHeaderPath: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        flex: 1,
    },
    sectionHeaderMachine: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 12, default: 13 }),
        lineHeight: Platform.select({ ios: 16, default: 18 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        maxWidth: 140,
        textAlign: 'right',
    },
    sessionRow: {
        height: 45,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
        // Reserve a 4px-wide attention strip on the left edge so rows that
        // gain it (sessionRowAttention) don't shift their text horizontally.
        borderLeftWidth: 4,
        borderLeftColor: 'transparent',
    },
    /** When the session is blocked on a user decision (permission prompt),
     *  highlight the whole row: amber left bar + faint amber background.
     *  Strong enough to spot at a glance, mild enough to not scream. */
    sessionRowAttention: {
        borderLeftColor: '#F59E0B',
        backgroundColor: 'rgba(245, 158, 11, 0.10)',
    },
    /** When the agent finished and there's an unread completion the user
     *  hasn't acknowledged. Less urgent than permission_required (no
     *  blocking tool prompt) but still wants attention. */
    sessionRowUnread: {
        borderLeftColor: '#007AFF',
        backgroundColor: 'rgba(0, 122, 255, 0.08)',
    },
    /** User-marked "pending review": agent reported done, user wants to come
     *  back and verify the result. Distinct from hasUnreadCompletion (auto)
     *  in that only the user clears it. Sits between unread (low) and
     *  permission_required (urgent) in the priority stack. */
    sessionRowReview: {
        borderLeftColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.10)',
    },
    /** Awaiting closure: the user has verified the agent's output and is
     *  keeping the session pinned to the top until they explicitly close it.
     *  Purple to distinguish from review (green) and unread (blue). */
    sessionRowClosure: {
        borderLeftColor: '#8B5CF6',
        backgroundColor: 'rgba(139, 92, 246, 0.10)',
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 16,
    },
    sessionRowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionTitle: {
        fontSize: 15,
        flex: 1,
        ...Typography.default('regular'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
    },
    newSessionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        height: 56,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    newSessionButtonDisabled: {
        opacity: 0.4,
    },
    newSessionButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    newSessionButtonIcon: {
        marginRight: 8,
        width: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newSessionButtonText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionReview: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#10B981',
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    unreadDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#007AFF',
        marginLeft: 4,
        marginRight: 8,
    },
}));

interface ActiveSessionsGroupProps {
    sessions: Session[];
    selectedSessionId?: string;
}


export function ActiveSessionsGroupCompact({ sessions, selectedSessionId }: ActiveSessionsGroupProps) {
    const styles = stylesheet;
    const machines = useAllMachines();
    const showSidebarGroupAvatar = useSetting('showSidebarGroupAvatar');
    const mergeWorktreeGroups = useSetting('mergeWorktreeGroups');
    // "Awaiting closure" lifts marked sessions to the top of their machine
    // group. Read the whole marks map so the sort can reorder live whenever
    // the user toggles a session.
    const awaitingClosureMarks = useAwaitingClosureMarks();

    const machinesMap = React.useMemo(() => {
        const map: Record<string, Machine> = {};
        machines.forEach(machine => {
            map[machine.id] = machine;
        });
        return map;
    }, [machines]);

    // Group sessions by project, then associate with machine
    const projectGroups = React.useMemo(() => {
        const groups = new Map<string, {
            path: string;
            displayPath: string;
            machines: Map<string, {
                machine: Machine | null;
                machineName: string;
                sessions: Session[];
            }>;
        }>();

        sessions.forEach(session => {
            // Group key: by default use the session's own path (one group per
            // worktree). When the user enables mergeWorktreeGroups, prefer
            // metadata.worktreeBasePath (the original repo path the CLI fills
            // when it spawns inside a worktree) and fall back to the parent
            // directory of the worktree path. The fallback handles the common
            // case where the CLI is too old to fill worktreeBasePath but the
            // worktree paths all share a parent (e.g. all ~/.happy-ai/
            // workspaces/vk-* collapse into ~/.happy-ai/workspaces).
            const ownPath = session.metadata?.path || '';
            let projectPath = ownPath;
            if (mergeWorktreeGroups) {
                const baseRepoPath = session.metadata?.worktreeBasePath;
                if (baseRepoPath) {
                    projectPath = baseRepoPath;
                } else {
                    // Take parent dir as the merge key. Strip trailing slashes
                    // first so a path that itself ends in '/' doesn't yield ''.
                    const trimmed = ownPath.replace(/\/+$/, '');
                    const parent = trimmed.replace(/\/[^/]+$/, '');
                    projectPath = parent || ownPath;
                }
            }
            const unknownText = t('status.unknown');
            const machineId = session.metadata?.machineId || unknownText;

            // Get machine info
            const machine = machineId !== unknownText ? machinesMap[machineId] : null;
            const machineName = machine?.metadata?.displayName ||
                machine?.metadata?.host ||
                (machineId !== unknownText ? machineId : `<${unknownText}>`);

            // Get or create project group
            let projectGroup = groups.get(projectPath);
            if (!projectGroup) {
                const displayPath = formatPathRelativeToHome(projectPath, session.metadata?.homeDir);
                projectGroup = {
                    path: projectPath,
                    displayPath,
                    machines: new Map()
                };
                groups.set(projectPath, projectGroup);
            }

            // Get or create machine group within project
            let machineGroup = projectGroup.machines.get(machineId);
            if (!machineGroup) {
                machineGroup = {
                    machine,
                    machineName,
                    sessions: []
                };
                projectGroup.machines.set(machineId, machineGroup);
            }

            // Add session to machine group
            machineGroup.sessions.push(session);
        });

        // Sort sessions within each machine group:
        //   1. Awaiting-closure marks float to the top (most-recently-marked
        //      first — recency of *marking*, not of createdAt).
        //   2. Plain rows fall back to createdAt descending (newest first).
        groups.forEach(projectGroup => {
            projectGroup.machines.forEach(machineGroup => {
                machineGroup.sessions.sort((a, b) => {
                    const aMark = awaitingClosureMarks[a.id] ?? 0;
                    const bMark = awaitingClosureMarks[b.id] ?? 0;
                    if (aMark !== bMark) return bMark - aMark;
                    return b.createdAt - a.createdAt;
                });
            });
        });

        return groups;
    }, [sessions, machinesMap, mergeWorktreeGroups, awaitingClosureMarks]);

    // Sort project groups by display path
    const sortedProjectGroups = React.useMemo(() => {
        return Array.from(projectGroups.entries()).sort(([, groupA], [, groupB]) => {
            return groupA.displayPath.localeCompare(groupB.displayPath);
        });
    }, [projectGroups]);

    return (
        <View style={styles.container}>
            {sortedProjectGroups.map(([projectPath, projectGroup]) => {
                const machineEntries = Array.from(projectGroup.machines.entries());
                const firstSession = machineEntries[0]?.[1]?.sessions[0];
                const avatarId = firstSession ? getSessionAvatarId(firstSession) : undefined;
                const singleMachineEntry = machineEntries.length === 1 ? machineEntries[0] : null;
                const singleMachineId = singleMachineEntry?.[0];

                return (
                    <View key={projectPath}>
                        {/* Section header on grouped background */}
                        <View style={styles.sectionHeader}>
                            <View style={styles.sectionHeaderLeft}>
                                {avatarId && showSidebarGroupAvatar && (
                                    <View style={styles.sectionHeaderAvatar}>
                                        <Avatar id={avatarId} size={24} flavor={firstSession?.metadata?.flavor} sessionIcon={firstSession?.metadata?.sessionIcon} />
                                    </View>
                                )}
                                <Text
                                    style={styles.sectionHeaderPath}
                                    numberOfLines={1}
                                    ref={(el: any) => { if (el) el.title = projectGroup.displayPath; }}
                                >
                                    {projectGroup.displayPath}
                                </Text>
                            </View>
                            {/* Only show git stats when this path maps to a single machine project key */}
                            {singleMachineId && firstSession?.metadata?.path ? (
                                <ProjectGitStatus
                                    machineId={singleMachineId}
                                    path={firstSession.metadata.path}
                                    sessionId={firstSession.id}
                                />
                            ) : null}
                            {!singleMachineEntry && (
                                <Text style={styles.sectionHeaderMachine} numberOfLines={1}>
                                    {`${projectGroup.machines.size} machines`}
                                </Text>
                            )}
                        </View>

                        {/* Card with just the sessions */}
                        <View style={styles.projectCard}>
                            {/* Sessions grouped by machine within the card */}
                            {Array.from(projectGroup.machines.entries())
                                .sort(([, machineA], [, machineB]) => machineA.machineName.localeCompare(machineB.machineName))
                                .map(([machineId, machineGroup]) => (
                                    <View key={`${projectPath}-${machineId}`}>
                                        {machineGroup.sessions.map((session, index) => (
                                            <CompactSessionRow
                                                key={session.id}
                                                session={session}
                                                selected={selectedSessionId === session.id}
                                                showBorder={index < machineGroup.sessions.length - 1 ||
                                                    Array.from(projectGroup.machines.keys()).indexOf(machineId) < projectGroup.machines.size - 1}
                                            />
                                        ))}
                                    </View>
                                ))}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

// Compact session row component with status line
const CompactSessionRow = React.memo(({ session, selected, showBorder }: { session: Session; selected?: boolean; showBorder?: boolean }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    // Read here too (not just at the parent) so each row can decide whether to
    // render its own per-session +/- chips. Cheap: useSetting returns from a
    // store with a stable selector — extra subscriptions don't re-render rows
    // unless the value flips.
    const mergeWorktreeGroups = useSetting('mergeWorktreeGroups');

    const [archivingSession, performArchive] = useHappyAction(async () => {
        const previousActive = storage.getState().sessions[session.id]?.active ?? session.active;
        storage.getState().updateSessionActivity(session.id, false);

        const result = await sessionKill(session.id);
        const errorMessage = result.message || t('sessionInfo.failedToArchiveSession');

        if (!result.success && /RPC method not available/i.test(errorMessage)) {
            return;
        }

        if (!result.success) {
            storage.getState().updateSessionActivity(session.id, previousActive);
            throw new HappyError(errorMessage, false);
        }
    });

    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    // User-marked "pending review" state. Manual toggle via right-click on web
    // and the green swipe action on native. Visible state: green left bar +
    // faint green bg + ✓ marker on the title row.
    const isPendingReview = useIsReviewPending(session.id);
    const isAwaitingClosure = useIsAwaitingClosure(session.id);
    const [rowMenuVisible, setRowMenuVisible] = React.useState(false);
    // PC right-click: anchor a small popover at the mouse position instead
    // of opening a full-width iOS-style bottom sheet (which on desktop
    // covered half the screen and felt out of place).
    const [rowMenuPos, setRowMenuPos] = React.useState<{ x: number; y: number } | null>(null);
    const handleToggleReview = React.useCallback(() => {
        swipeableRef.current?.close();
        setRowMenuVisible(false);
        setRowMenuPos(null);
        void toggleReviewPending(session.id);
    }, [session.id]);
    const handleToggleAwaitingClosure = React.useCallback(() => {
        swipeableRef.current?.close();
        setRowMenuVisible(false);
        setRowMenuPos(null);
        void toggleAwaitingClosure(session.id);
    }, [session.id]);
    const handleRowContextMenu = React.useCallback((e: any) => {
        // Web only — onContextMenu fires from RN-Web's div forwarding.
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const x = typeof e?.clientX === 'number' ? e.clientX : 0;
        const y = typeof e?.clientY === 'number' ? e.clientY : 0;
        setRowMenuPos({ x, y });
    }, []);
    // Reuse the existing happy "rename session" feature (server-side
    // sessionUpdateSummary + promptWithCheckbox UI with the "fixed title"
    // toggle) — same modal that lives on the session info page.
    const handleRenameSession = React.useCallback(async () => {
        setRowMenuVisible(false);
        setRowMenuPos(null);
        if (!session.metadata) return;
        const result = await Modal.promptWithCheckbox(
            t('sessionInfo.renameSession'),
            t('sessionInfo.renameSessionHint'),
            {
                defaultValue: session.metadata.summary?.text || '',
                placeholder: getSessionName(session),
                cancelText: t('common.cancel'),
                confirmText: t('common.rename'),
                checkbox: {
                    label: t('sessionInfo.pinSessionTitle'),
                    defaultValue: session.metadata.summaryPinned ?? false,
                },
            },
        );
        if (result === null) return;
        const trimmed = result.value.trim();
        if (!trimmed) return;
        try {
            await sessionUpdateSummary(
                session.id,
                session.metadata,
                trimmed,
                session.metadataVersion,
                result.checked,
            );
        } catch (e) {
            Modal.alert(
                t('common.error'),
                e instanceof Error ? e.message : t('sessionInfo.failedToRenameSession'),
            );
        }
    }, [session.id, session.metadata, session.metadataVersion]);
    const rowMenuItems = React.useMemo<ActionMenuItem[]>(() => [
        {
            label: t('sessionInfo.renameSession'),
            onPress: () => { void handleRenameSession(); },
        },
        {
            label: isPendingReview
                ? t('sidebar.review.unmark')
                : t('sidebar.review.mark'),
            onPress: handleToggleReview,
        },
        {
            label: isAwaitingClosure
                ? t('sidebar.closure.unmark')
                : t('sidebar.closure.mark'),
            onPress: handleToggleAwaitingClosure,
        },
    ], [isPendingReview, isAwaitingClosure, handleToggleReview, handleToggleAwaitingClosure, handleRenameSession]);

    const handleArchive = React.useCallback(() => {
        swipeableRef.current?.close();
        const worktreeInfo = getWorktreeInfo(session.metadata);
        if (worktreeInfo && session.metadata?.machineId) {
            const machineId = session.metadata.machineId;
            const { basePath, branchName } = worktreeInfo;
            setArchiveMenuItems([
                {
                    label: t('sessionInfo.worktree.archiveKeepWorktree'),
                    onPress: () => { setArchiveMenuVisible(false); performArchive(); },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupKeepBranch'),
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try { await cleanupWorktree(machineId, basePath, branchName, false); } catch (e) { console.warn('Worktree cleanup failed:', e); }
                        await performArchive();
                    },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'),
                    destructive: true,
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try { await cleanupWorktree(machineId, basePath, branchName, true); } catch (e) { console.warn('Worktree cleanup failed:', e); }
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
                        onPress: performArchive
                    }
                ]
            );
        }
    }, [performArchive, session.metadata]);

    const itemContent = (
        <Pressable
            // @ts-ignore — RN-Web's Pressable forwards onContextMenu to the host div.
            onContextMenu={Platform.OS === 'web' ? handleRowContextMenu : undefined}
            style={[
                styles.sessionRow,
                selected && styles.sessionRowSelected,
                // Style priority (last wins): permission_required (urgent) >
                // awaiting closure (purple) > review (green) > unread (blue).
                // Awaiting-closure outranks review because it's the later
                // lifecycle stage (verified → pending close-out).
                sessionStatus.hasUnreadCompletion && styles.sessionRowUnread,
                isPendingReview && styles.sessionRowReview,
                isAwaitingClosure && styles.sessionRowClosure,
                sessionStatus.state === 'permission_required' && styles.sessionRowAttention,
            ]}
            onPressIn={() => {
                if (isTablet) {
                    navigateToSession(session.id);
                }
            }}
            onPress={() => {
                if (!isTablet) {
                    navigateToSession(session.id);
                }
            }}
        >
            <View style={styles.sessionContent}>
                {/* Title line with status */}
                <View style={styles.sessionTitleRow}>
                    {/* Status dot or draft icon on the left */}
                    {(() => {
                        // Show draft icon when online with draft
                        if (sessionStatus.state === 'waiting' && session.draft) {
                            return (
                                <Ionicons
                                    name="create-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                    style={{ marginRight: 8 }}
                                />
                            );
                        }
                        
                        // Show status dot only for permission_required/thinking states
                        if (sessionStatus.state === 'permission_required' || sessionStatus.state === 'thinking') {
                            return (
                                <View style={[styles.statusDotContainer, { marginRight: 8 }]}>
                                    <StatusDot
                                        color={sessionStatus.statusDotColor}
                                        isPulsing={sessionStatus.isPulsing}
                                        size={12}
                                    />
                                </View>
                            );
                        }

                        // Show blue unread dot for completed tasks
                        if (sessionStatus.hasUnreadCompletion) {
                            return (
                                <View style={[styles.unreadDot, { marginRight: 8 }]} />
                            );
                        }

                        // Show grey dot for online without draft
                        if (sessionStatus.state === 'waiting') {
                            return (
                                <View style={[styles.statusDotContainer, { marginRight: 8 }]}>
                                    <StatusDot
                                        color={theme.colors.textSecondary}
                                        isPulsing={false}
                                        size={12}
                                    />
                                </View>
                            );
                        }
                        
                        return null;
                    })()}
                    
                    <Text
                        style={[
                            styles.sessionTitle,
                            sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                        ]}
                        numberOfLines={2}
                    >
                        {sessionName}
                    </Text>
                    {isPendingReview && (
                        <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color="#10B981"
                            style={{ marginLeft: 6 }}
                        />
                    )}
                    {/* In merge mode the group header shows the *aggregate*
                      * +/- across all worktrees; pin per-row stats here so the
                      * user can still tell which worktree did how much. Skip
                      * in non-merge mode — the group header already shows the
                      * row-equivalent number, repeating it is noise. */}
                    {mergeWorktreeGroups && (
                        <View style={{ marginLeft: 8, flexShrink: 0 }}>
                            <ProjectGitStatus sessionId={session.id} />
                        </View>
                    )}
                </View>
            </View>
            {sessionStatus.state === 'thinking' && (
                /* Amber matches permission_required attention strip; the two
                 * states are mutually exclusive in the state machine, so the
                 * shared color reads as "this row wants attention". */
                <SessionThinkingBar color="#F59E0B" />
            )}
        </Pressable>
    );

    const archiveModal = (
        <ActionMenuModal
            visible={archiveMenuVisible}
            title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
            items={archiveMenuItems}
            onClose={() => setArchiveMenuVisible(false)}
        />
    );

    // PC right-click popover — anchored at the mouse position. Lives inside
    // a transparent Modal so it floats above the drawer and intercepts the
    // outside click for dismissal. Native uses the bottom-sheet `rowMenu`
    // below as a fallback (unreachable in practice since we don't bind
    // onContextMenu on native, but kept for safety and parity).
    const closeRowMenuPopover = () => setRowMenuPos(null);
    const rowMenuPopover = rowMenuPos && Platform.OS === 'web' ? (
        <RNModal transparent visible animationType="none" onRequestClose={closeRowMenuPopover}>
            <Pressable
                onPress={closeRowMenuPopover}
                // @ts-ignore — RN-Web supports onContextMenu via host div forwarding.
                onContextMenu={(e: any) => { e?.preventDefault?.(); closeRowMenuPopover(); }}
                style={{ flex: 1 }}
            >
                {/* Clamp to viewport: 200px-wide menu can't overflow right
                    edge or bottom; offset 2px so the cursor isn't on the
                    menu itself when it opens. */}
                <View
                    onStartShouldSetResponder={() => true}
                    style={{
                        position: 'absolute',
                        left: Math.min(rowMenuPos.x + 2, (typeof window !== 'undefined' ? window.innerWidth : 0) - 220),
                        top: Math.min(rowMenuPos.y + 2, (typeof window !== 'undefined' ? window.innerHeight : 0) - 120),
                        minWidth: 200,
                        backgroundColor: theme.colors.surface,
                        borderRadius: 8,
                        paddingVertical: 4,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.18,
                        shadowRadius: 12,
                        elevation: 12,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.divider,
                    }}
                >
                    {rowMenuItems.map((item, idx) => (
                        <Pressable
                            key={idx}
                            onPress={() => { item.onPress?.(); }}
                            style={({ pressed, hovered }: any) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 9,
                                backgroundColor: hovered || pressed ? theme.colors.surfacePressed : 'transparent',
                            })}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: item.destructive ? theme.colors.textDestructive : theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {item.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </Pressable>
        </RNModal>
    ) : null;

    // Native fallback bottom-sheet (unused on web; mobile would only use
    // this if we ever bind onLongPress on the row).
    const rowMenu = (
        <ActionMenuModal
            visible={rowMenuVisible}
            items={rowMenuItems}
            onClose={() => setRowMenuVisible(false)}
        />
    );

    if (!swipeEnabled) {
        return (
            <>
                {itemContent}
                {showBorder && <View style={styles.sessionDivider} />}
                {archiveModal}
                {rowMenu}
                {rowMenuPopover}
            </>
        );
    }

    const renderRightActions = () => (
        <View style={{ flexDirection: 'row' }}>
            <Pressable
                style={styles.swipeActionReview}
                onPress={handleToggleReview}
            >
                <Ionicons
                    name={isPendingReview ? 'close-circle-outline' : 'checkmark-circle-outline'}
                    size={20}
                    color="#FFFFFF"
                />
                <Text style={styles.swipeActionText} numberOfLines={2}>
                    {isPendingReview ? t('sidebar.review.unmark') : t('sidebar.review.mark')}
                </Text>
            </Pressable>
            <Pressable
                style={styles.swipeAction}
                onPress={handleArchive}
                disabled={archivingSession}
            >
                <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
                <Text style={styles.swipeActionText} numberOfLines={2}>
                    {t('sessionInfo.archiveSession')}
                </Text>
            </Pressable>
        </View>
    );

    return (
        <>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!archivingSession}
            >
                {itemContent}
            </Swipeable>
            {showBorder && <View style={styles.sessionDivider} />}
            {archiveModal}
            {rowMenu}
            {rowMenuPopover}
        </>
    );
});

/**
 * Indeterminate progress bar pinned to the bottom of a session row to signal
 * "agent is thinking". Absolute-positioned (height-neutral, doesn't push the
 * row from 45px). The 40%-wide sub-bar slides left→right on a 1.5s loop using
 * GPU-only translateX (useNativeDriver=true on native; CSS transform on web).
 */
function SessionThinkingBar({ color }: { color: string }) {
    const x = React.useRef(new Animated.Value(0)).current;
    const [width, setWidth] = React.useState(0);

    React.useEffect(() => {
        if (width <= 0) return;
        const loop = Animated.loop(
            Animated.timing(x, {
                toValue: 1,
                duration: 1500,
                // Native driver doesn't exist on web; using JS driver there
                // makes the percentage→px translateX actually animate.
                useNativeDriver: Platform.OS !== 'web',
            }),
        );
        loop.start();
        return () => { loop.stop(); };
    }, [x, width]);

    // 40% of row width; clamp to a minimum so very narrow sidebars still show
    // a visible bar instead of collapsing.
    const subBarWidth = Math.max(40, width * 0.4);

    return (
        <View
            pointerEvents="none"
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 2,
                overflow: 'hidden',
            }}
        >
            {width > 0 && (
                <Animated.View
                    style={{
                        width: subBarWidth,
                        height: 2,
                        backgroundColor: color,
                        transform: [{
                            // From off-screen left (-subBarWidth) to off-screen right (width).
                            translateX: x.interpolate({
                                inputRange: [0, 1],
                                outputRange: [-subBarWidth, width],
                            }),
                        }],
                    }}
                />
            )}
        </View>
    );
}
