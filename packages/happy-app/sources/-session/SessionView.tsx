import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput, type AgentQuickAction } from '@/components/AgentInput';
import { Avatar } from '@/components/Avatar';
import { MultiTextInputHandle } from '@/components/MultiTextInput';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { ChatList } from '@/components/ChatList';
import { Deferred } from '@/components/Deferred';
import { DuplicateSheet } from '@/components/DuplicateSheet';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { EmptyMessages } from '@/components/EmptyMessages';
import { PendingQueuePanel } from '@/components/PendingQueuePanel';
import { buildPendingQueueBatchPrompt } from '@/components/pendingQueueBatchPrompt';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { GitHubIssueDetailModal } from '@/components/GitHubIssueDetailModal';
import { useDraft } from '@/hooks/useDraft';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { useResumeSession } from '@/hooks/useResumeSession';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { sessionAbort, sessionDelete, machineGetClaudeSessionUserMessages, machineDuplicateClaudeSession, machineSpawnNewSession, machineGetGeminiSessionUserMessages, machineDuplicateGeminiSession, machineGetCodexSessionUserMessages, machineDuplicateCodexSession, type UserMessageWithUuid } from '@/sync/ops';
import type { GitHubIssue } from '@/sync/apiGithub';
import { storage, useIsDataReady, useLocalSetting, useLocalSettingMutable, useOrchestratorRunningTaskCount, useRealtimeStatus, useSessionMessages, useSessionPendingMessages, useSessionUsage, useSetting, useSettingMutable } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { InjectedMemoriesModal } from '@/components/InjectedMemoriesModal';
import * as Clipboard from 'expo-clipboard';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { t } from '@/text';
import { tracking, trackMessageSent } from '@/track';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { formatPathRelativeToHome, generateCopyTitle, getSessionAvatarId, getSessionName, useSessionStatus, copySessionMetadata, copySessionModeSettings } from '@/utils/sessionUtils';
import { isVersionSupported, useLatestCliVersion } from '@/utils/versionUtils';
import { log } from '@/log';
import { HappyError } from '@/utils/errors';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { RightPanel, RightPanelType } from '@/components/RightPanel';
import { FileViewerModal } from '@/components/FileViewerModal';
import { TerminalPanel } from '@/components/Terminal';
import { buildCopyToAgentBriefPrompt } from './sessionCopyPrompt';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { CustomQuickActionSchema } from '@/sync/localSettings';

const SILENT_REFRESH_INDICATOR_DELAY_MS = 3000;
const SILENT_REFRESH_FAILED_TIMEOUT_MS = 12000;

// Spreads a `title` HTML attribute onto Pressable on web (becomes a native
// hover tooltip). No-op on native — RN Core ignores unknown props.
const webTooltip = (label: string): Record<string, string> => (
    Platform.OS === 'web' ? { title: label } : {}
);

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function buildLinkedGitHubIssue(session: Session | null | undefined): GitHubIssue | null {
    const context = session?.metadata?.externalContext;
    if (!context || context.source !== 'github' || context.resourceType !== 'issue') {
        return null;
    }

    const extra = context.extra && typeof context.extra === 'object'
        ? context.extra as Record<string, unknown>
        : {};
    const resourceMatch = context.resourceId.match(/^(.+)#(\d+)$/);
    const repository = readString(extra.repository) || resourceMatch?.[1];
    const numberValue = typeof extra.number === 'number' ? extra.number : Number(resourceMatch?.[2]);
    if (!repository || !Number.isFinite(numberValue) || numberValue <= 0) {
        return null;
    }

    const title = readString(context.title)?.replace(new RegExp(`^#${numberValue}\\s+`), '')
        || readString(extra.title)
        || `#${numberValue}`;
    const htmlUrl = readString(extra.htmlUrl) || context.sourceUrl || context.deepLink || '';

    return {
        id: 0,
        number: numberValue,
        title,
        body: readString(extra.body) ?? null,
        htmlUrl,
        repository,
        state: readString(extra.state) || 'open',
        updatedAt: readString(extra.updatedAt) || '',
        labels: readStringArray(extra.labels),
        assignees: readStringArray(extra.assignees),
        projectStatuses: readStringArray(extra.projectStatuses),
        projectTitles: readStringArray(extra.projectTitles),
    };
}

type CopyTargetAgent = 'claude' | 'codex';

function formatCopyTargetAgent(agent: CopyTargetAgent): string {
    return agent === 'codex' ? 'Codex' : 'Claude';
}

function mapPermissionModeForCopyTarget(
    permissionMode: Session['permissionMode'],
    targetAgent: CopyTargetAgent,
): NonNullable<Session['permissionMode']> {
    const mode = permissionMode || 'default';
    if (targetAgent === 'codex') {
        return (mode === 'read-only' || mode === 'safe-yolo' || mode === 'yolo' || mode === 'default')
            ? mode
            : 'default';
    }
    return (mode === 'acceptEdits' || mode === 'plan' || mode === 'bypassPermissions' || mode === 'yolo' || mode === 'default')
        ? mode
        : 'default';
}

function applyQuickActionPlaceholders(prompt: string, params: { projectPath: string }): string {
    return prompt.replaceAll('{{projectPath}}', params.projectPath);
}

function isCustomTaskBriefAction(action: { label: string; prompt: string }, defaultTaskBriefAction: AgentQuickAction): boolean {
    return action.label.trim() === defaultTaskBriefAction.label
        || action.prompt.includes('happy task brief --recent')
        || action.prompt.includes('happy task brief --session');
}

export const SessionView = React.memo((props: { id: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const realtimeStatus = useRealtimeStatus();
    const isTablet = useIsTablet();
    const { width: windowWidth } = useWindowDimensions();
    // Desktop web: open files/info as a right-side panel instead of pushing routes.
    // Threshold 1024px = roughly the smallest screen where 480px panel + chat still feels uncramped.
    const isDesktopPanelMode = Platform.OS === 'web' && windowWidth >= 1024;
    const [rightPanelType, setRightPanelType] = React.useState<RightPanelType | null>(null);
    // PC code-slash button (rendered in this header) opens the bt-style FileViewerModal
    // mounted inside SessionViewLoaded; state lives here so the button can read/toggle it.
    const [showFileViewer, setShowFileViewer] = React.useState(false);
    // Terminal modal: web + tablet only (no room for an xterm UI on phones).
    // Mounted inside SessionViewLoaded so it has session context, but state
    // lives here so the header button can flip it.
    const [showTerminal, setShowTerminal] = React.useState(false);
    const showTerminalButton = Platform.OS === 'web' && isTablet;
    // Reset panel if shrinking out of desktop mode (avoid stale panel state on resize).
    React.useEffect(() => {
        if (!isDesktopPanelMode && rightPanelType) setRightPanelType(null);
    }, [isDesktopPanelMode, rightPanelType]);
    const runningTaskCount = useOrchestratorRunningTaskCount(sessionId);

    // Header memory chip — count of memories actually injected into THIS session's
    // system prompt (not total user memories). Tap opens the same modal as the
    // Info-panel chip so semantics stay aligned across both surfaces.
    const injectedMemoryIds = React.useMemo(
        () => session?.metadata?.injectedMemoryIds ?? [],
        [session?.metadata?.injectedMemoryIds],
    );
    const memoryCount = injectedMemoryIds.length;
    const [injectedMemoriesOpen, setInjectedMemoriesOpen] = React.useState(false);
    const handleOpenSessionRuns = React.useCallback(() => {
        if (isDesktopPanelMode) {
            setRightPanelType(prev => (prev === 'orchestrator' ? null : 'orchestrator'));
        } else {
            router.push(`/orchestrator?controllerSessionId=${encodeURIComponent(sessionId)}`);
        }
    }, [router, sessionId, isDesktopPanelMode]);
    const linkedGitHubIssue = React.useMemo(() => buildLinkedGitHubIssue(session), [session]);
    const handleOpenLinkedGitHubIssue = React.useCallback(() => {
        if (!linkedGitHubIssue) return;
        Modal.show({
            component: GitHubIssueDetailModal,
            props: {
                issue: linkedGitHubIssue,
                fetchLatest: true,
            },
        });
    }, [linkedGitHubIssue]);

    // Track if we've confirmed the session doesn't exist after data loads
    const [sessionNotFound, setSessionNotFound] = React.useState(false);

    // When session appears, reset the not found state
    React.useEffect(() => {
        if (session) {
            setSessionNotFound(false);
        }
    }, [session]);

    // When session doesn't exist, refresh sessions and check again
    React.useEffect(() => {
        if (!isDataReady || session || sessionNotFound) {
            return;
        }

        let cancelled = false;

        // Refresh sessions and then check if session exists
        sync.refreshSessions()
            .then(() => {
                if (cancelled) return;
                // After refresh, check if session exists in storage (owned or shared)
                if (!storage.getState().sessions[sessionId] && !storage.getState().sharedSessions[sessionId]) {
                    setSessionNotFound(true);
                }
            })
            .catch(() => {
                // On error, mark as not found to avoid infinite loading
                if (!cancelled) {
                    setSessionNotFound(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isDataReady, session, sessionId, sessionNotFound]);

    // Compute header props based on session state
    const headerProps = useMemo(() => {
        if (!isDataReady) {
            // Loading state - show empty header
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        if (!session) {
            // Show deleted message only if we've confirmed session doesn't exist
            // Otherwise show empty header while waiting for data
            return {
                title: sessionNotFound ? t('errors.sessionDeleted') : '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        // Normal state - show session info
        const isConnected = session.presence === 'online';
        return {
            title: getSessionName(session),
            subtitle: session.metadata?.path ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir) : undefined,
            avatarId: getSessionAvatarId(session),
            onAvatarPress: () => {
                if (isDesktopPanelMode) {
                    setRightPanelType(prev => (prev === 'info' ? null : 'info'));
                } else {
                    router.push(`/session/${sessionId}/info`);
                }
            },
            isConnected: isConnected,
            flavor: session.metadata?.flavor || null,
            sessionIcon: session.metadata?.sessionIcon || null,
            tintColor: isConnected ? '#000' : '#8E8E93'
        };
    }, [session, isDataReady, sessionId, router, sessionNotFound, isDesktopPanelMode]);

    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1, position: 'relative' }}>
            {/* Status bar shadow for landscape mode */}
            {isLandscape && deviceType === 'phone' && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: theme.colors.surface,
                    zIndex: 1000,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: {
                        width: 0,
                        height: 2,
                    },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 3,
                    elevation: 5,
                }} />
            )}

            {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
            {!(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1000
                }}>
                    <ChatHeaderView
                        {...headerProps}
                        onBackPress={() => router.back()}
                        headerRight={session ? () => {
                            const copyId = async (id: string) => {
                                await Clipboard.setStringAsync(id);
                                hapticsLight();
                                showCopiedToast();
                            };
                            return (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {/* Quick copy: Happy session ID (always present). */}
                                <Pressable
                                    {...webTooltip(t('sessionInfo.happySessionId'))}
                                    onPress={() => copyId(session.id)}
                                    hitSlop={15}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('sessionInfo.happySessionId')}
                                    style={{
                                        width: 38,
                                        height: 38,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginRight: 2,
                                    }}
                                >
                                    <Ionicons name="finger-print-outline" size={20} color={theme.colors.header.tint} />
                                </Pressable>
                                {linkedGitHubIssue && (
                                    <Pressable
                                        {...webTooltip('查看任务内容')}
                                        onPress={handleOpenLinkedGitHubIssue}
                                        hitSlop={15}
                                        accessibilityRole="button"
                                        accessibilityLabel="查看任务内容"
                                        style={{
                                            width: 38,
                                            height: 38,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginRight: 2,
                                        }}
                                    >
                                        <Ionicons name="ticket-outline" size={21} color={theme.colors.header.tint} />
                                    </Pressable>
                                )}
                                {/* Injected-memories badge — count = memories actually merged into
                                    THIS session's system prompt. Tap opens the same modal as the
                                    Info-panel chip (mute toggles + manage-all link). */}
                                {memoryCount > 0 && (
                                    <Pressable
                                        onPress={() => setInjectedMemoriesOpen(true)}
                                        hitSlop={15}
                                        accessibilityRole="button"
                                        accessibilityLabel="Memories"
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: 3,
                                            paddingHorizontal: 8,
                                            height: 38,
                                            justifyContent: 'center',
                                            marginRight: 2,
                                        }}
                                    >
                                        <Ionicons name="library-outline" size={18} color={theme.colors.header.tint} />
                                        <Text style={{
                                            fontSize: 12,
                                            fontWeight: '600',
                                            color: theme.colors.header.tint,
                                        }}>
                                            {memoryCount}
                                        </Text>
                                    </Pressable>
                                )}
                                {runningTaskCount > 0 && (
                                    <Pressable
                                        onPress={handleOpenSessionRuns}
                                        hitSlop={15}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('settings.orchestratorOpenRuns')}
                                        style={{
                                            width: 38,
                                            height: 38,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginRight: 2,
                                        }}
                                    >
                                        <Ionicons
                                            name="layers-outline"
                                            size={22}
                                            color={isDesktopPanelMode && rightPanelType === 'orchestrator' ? theme.colors.button.primary.background : theme.colors.header.tint}
                                        />
                                        <View style={{
                                            position: 'absolute',
                                            top: 2,
                                            right: 0,
                                            backgroundColor: theme.colors.button.primary.background,
                                            borderRadius: 8,
                                            minWidth: 16,
                                            height: 16,
                                            paddingHorizontal: 3,
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}>
                                            <Text style={{
                                                color: theme.colors.button.primary.tint,
                                                fontSize: 10,
                                                fontWeight: '600',
                                            }}>
                                                {runningTaskCount > 99 ? '99+' : runningTaskCount}
                                            </Text>
                                        </View>
                                    </Pressable>
                                )}
                                <Pressable
                                    onPress={() => {
                                        if (isDesktopPanelMode) {
                                            // PC: open the full bt-style modal directly,
                                            // skip the RightPanel browser drawer.
                                            setShowFileViewer(true);
                                        } else {
                                            router.push(`/session/${sessionId}/browser`);
                                        }
                                    }}
                                    hitSlop={15}
                                    accessibilityRole="button"
                                    accessibilityLabel="Code"
                                    style={{
                                        width: 38,
                                        height: 38,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginRight: 2,
                                    }}
                                >
                                    <Ionicons
                                        name="code-slash-outline"
                                        size={22}
                                        color={isDesktopPanelMode && showFileViewer ? theme.colors.button.primary.background : theme.colors.header.tint}
                                    />
                                </Pressable>
                                {/* Terminal: web + tablet only. Phones don't
                                    have room for an xterm surface, and the
                                    underlying xterm.js bundle is web-only. */}
                                {showTerminalButton && (
                                    <Pressable
                                        {...webTooltip('Terminal')}
                                        onPress={() => setShowTerminal(prev => !prev)}
                                        hitSlop={15}
                                        accessibilityRole="button"
                                        accessibilityLabel="Terminal"
                                        style={{
                                            width: 38,
                                            height: 38,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginRight: 2,
                                        }}
                                    >
                                        <Ionicons
                                            name="terminal-outline"
                                            size={22}
                                            color={showTerminal ? theme.colors.button.primary.background : theme.colors.header.tint}
                                        />
                                    </Pressable>
                                )}
                                {headerProps.avatarId && headerProps.onAvatarPress && (
                                    <Pressable
                                        onPress={headerProps.onAvatarPress}
                                        hitSlop={15}
                                        style={{
                                            width: 44,
                                            height: 44,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginRight: Platform.select({ web: -8, default: -4 }),
                                        }}
                                    >
                                        <Avatar
                                            id={headerProps.avatarId}
                                            size={32}
                                            monochrome={!headerProps.isConnected}
                                            flavor={headerProps.flavor}
                                            sessionIcon={headerProps.sessionIcon}
                                        />
                                    </Pressable>
                                )}
                            </View>
                            );
                        } : undefined}
                    />
                    {/* Voice status bar below header - not on tablet (shown in sidebar) */}
                    {!isTablet && realtimeStatus !== 'disconnected' && (
                        <VoiceAssistantStatusBar variant="full" />
                    )}
                </View>
            )}

            {/* Content based on state */}
            <View style={{ flex: 1, paddingTop: !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') ? safeArea.top + headerHeight + (!isTablet && realtimeStatus !== 'disconnected' ? 48 : 0) : 0 }}>
                {!isDataReady ? (
                    // Loading state - initial data not ready
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session && !sessionNotFound ? (
                    // Loading state - waiting for session data to arrive
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session && sessionNotFound ? (
                    // Deleted state - confirmed session doesn't exist
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : session ? (
                    // Normal session view
                    <SessionViewLoaded
                        key={sessionId}
                        sessionId={sessionId}
                        session={session}
                        isDesktopPanelMode={isDesktopPanelMode}
                        rightPanelType={rightPanelType}
                        setRightPanelType={setRightPanelType}
                        showFileViewer={showFileViewer}
                        setShowFileViewer={setShowFileViewer}
                        showTerminal={showTerminal}
                        setShowTerminal={setShowTerminal}
                    />
                ) : null}
            </View>
            </View>
            {isDesktopPanelMode && rightPanelType && (
                <RightPanel
                    sessionId={sessionId}
                    type={rightPanelType}
                    onClose={() => setRightPanelType(null)}
                    onTypeChange={setRightPanelType}
                />
            )}
            {/* Injected-memories modal — opened by the header memory chip */}
            <InjectedMemoriesModal
                visible={injectedMemoriesOpen}
                onClose={() => setInjectedMemoriesOpen(false)}
                sessionId={sessionId}
                injectedMemoryIds={injectedMemoryIds}
            />
        </View>
    );
});


function SessionViewLoaded({ sessionId, session, isDesktopPanelMode, rightPanelType, setRightPanelType, showFileViewer, setShowFileViewer, showTerminal, setShowTerminal }: {
    sessionId: string;
    session: Session;
    isDesktopPanelMode: boolean;
    rightPanelType: RightPanelType | null;
    setRightPanelType: React.Dispatch<React.SetStateAction<RightPanelType | null>>;
    showFileViewer: boolean;
    setShowFileViewer: React.Dispatch<React.SetStateAction<boolean>>;
    showTerminal: boolean;
    setShowTerminal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const [message, setMessage] = React.useState('');
    const realtimeStatus = useRealtimeStatus();
    const { messages, isLoaded, fetchVersion } = useSessionMessages(sessionId);
    const pendingMessages = useSessionPendingMessages(sessionId);
    const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');

    // Check if CLI version is outdated and not already acknowledged
    const cliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const latestCliVersion = useLatestCliVersion();
    const isCliOutdated = cliVersion && latestCliVersion && !isVersionSupported(cliVersion, latestCliVersion);
    const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
    const shouldShowCliWarning = isCliOutdated && !isAcknowledged;
    // Get permission mode from session object, default to 'default'
    const permissionMode = session.permissionMode || 'default';
    // Get model mode from session object. "default" means use CLI/profile configured model.
    const modelMode = session.modelMode || 'default';
    const fastMode = session.fastMode ?? false;
    const sessionStatus = useSessionStatus(session);
    const sessionUsage = useSessionUsage(sessionId);
    const alwaysShowContextSize = useSetting('alwaysShowContextSize');
    const [syncedCustomQuickActions, setCustomQuickActions] = useSettingMutable('customQuickActions');
    const [legacyLocalCustomQuickActions, setLegacyLocalCustomQuickActions] = useLocalSettingMutable('customQuickActions');
    const customQuickActions = syncedCustomQuickActions.length > 0
        ? syncedCustomQuickActions
        : legacyLocalCustomQuickActions;
    const [silentRefreshTrackingKey, setSilentRefreshTrackingKey] = React.useState(0);
    const [silentRefreshPhase, setSilentRefreshPhase] = React.useState<'idle' | 'refreshing' | 'failed'>('idle');
    const latestMessageSnapshotRef = React.useRef({ isLoaded, messages, fetchVersion });
    latestMessageSnapshotRef.current = { isLoaded, messages, fetchVersion };
    const silentRefreshBaselineRef = React.useRef<{ isLoaded: boolean; messagesRef: typeof messages; fetchVersion: number } | null>(null);

    const startSilentRefreshTracking = React.useCallback(() => {
        const snapshot = latestMessageSnapshotRef.current;
        if (!snapshot.isLoaded) {
            setSilentRefreshTrackingKey(0);
            setSilentRefreshPhase('idle');
            silentRefreshBaselineRef.current = null;
            return;
        }

        silentRefreshBaselineRef.current = {
            isLoaded: snapshot.isLoaded,
            messagesRef: snapshot.messages,
            fetchVersion: snapshot.fetchVersion,
        };
        setSilentRefreshTrackingKey((k) => k + 1);
        setSilentRefreshPhase('idle');
    }, []);

    const isTracking = silentRefreshTrackingKey > 0;

    React.useEffect(() => {
        if (!isTracking) {
            return;
        }
        const baseline = silentRefreshBaselineRef.current;
        if (!baseline) {
            return;
        }
        if (messages !== baseline.messagesRef || isLoaded !== baseline.isLoaded || fetchVersion !== baseline.fetchVersion) {
            setSilentRefreshTrackingKey(0);
            setSilentRefreshPhase('idle');
            silentRefreshBaselineRef.current = null;
        }
    }, [isTracking, isLoaded, messages, fetchVersion]);

    React.useEffect(() => {
        if (!isTracking) {
            return;
        }
        const refreshingTimer = setTimeout(() => {
            setSilentRefreshPhase((prev) => (prev === 'idle' ? 'refreshing' : prev));
        }, SILENT_REFRESH_INDICATOR_DELAY_MS);
        const failedTimer = setTimeout(() => {
            setSilentRefreshPhase((prev) => {
                if (prev === 'idle' || prev === 'refreshing') {
                    return 'failed';
                }
                return prev;
            });
        }, SILENT_REFRESH_FAILED_TIMEOUT_MS);
        return () => {
            clearTimeout(refreshingTimer);
            clearTimeout(failedTimer);
        };
    }, [isTracking, silentRefreshTrackingKey]);

    const handleRetryStatusRefresh = React.useCallback(() => {
        startSilentRefreshTracking();
        setSilentRefreshPhase('refreshing');
        void sync.refreshSessions().catch(() => {
            // Keep current phase and rely on timeout-based feedback.
        });
    }, [startSilentRefreshTracking]);

    const isRefreshingStatus = silentRefreshPhase === 'refreshing' || sessionStatus.state === 'syncing';

    const inputConnectionStatus = React.useMemo(() => {
        if (silentRefreshPhase === 'failed') {
            return {
                text: t('status.refreshFailed'),
                color: theme.colors.status.error,
                dotColor: theme.colors.status.error,
                isPulsing: false,
                onPress: handleRetryStatusRefresh
            };
        }
        if (isRefreshingStatus) {
            return {
                text: t('status.refreshing'),
                color: theme.colors.status.connecting,
                dotColor: theme.colors.status.connecting,
                isPulsing: true
            };
        }
        return {
            text: sessionStatus.statusText,
            color: sessionStatus.statusColor,
            dotColor: sessionStatus.statusDotColor,
            isPulsing: sessionStatus.isPulsing,
            ...(sessionStatus.state === 'permission_required' && { action: 'openPermission' as const }),
        };
    }, [silentRefreshPhase, isRefreshingStatus, sessionStatus, theme.colors.status.connecting, theme.colors.status.error, handleRetryStatusRefresh]);

    // Ref for the input component (used for web auto-focus)
    const inputRef = React.useRef<MultiTextInputHandle>(null);
    const sessionProjectPath = session.metadata?.path ?? '.';
    const resolveTaskBriefPrompt = React.useCallback(async () => {
        const sessionId = await Modal.prompt(
            t('agentInput.quickActions.taskBrief.sessionIdTitle'),
            t('agentInput.quickActions.taskBrief.sessionIdPrompt'),
            {
                defaultValue: session.id,
                placeholder: t('agentInput.quickActions.taskBrief.sessionIdPlaceholder'),
                confirmText: t('common.ok'),
                cancelText: t('common.cancel'),
            },
        );
        const trimmed = sessionId?.trim();
        if (!trimmed) return null;
        return t('agentInput.quickActions.taskBrief.promptForSession', {
            sessionId: trimmed,
            projectPath: sessionProjectPath,
        });
    }, [session.id, sessionProjectPath]);
    const defaultQuickActions = React.useMemo<AgentQuickAction[]>(() => [
        {
            key: 'taskBrief',
            label: t('agentInput.quickActions.taskBrief.title'),
            description: t('agentInput.quickActions.taskBrief.description'),
            prompt: t('agentInput.quickActions.taskBrief.prompt', { projectPath: sessionProjectPath }),
            resolvePrompt: resolveTaskBriefPrompt,
            icon: 'git-pull-request-outline',
        },
        {
            key: 'releaseGuard',
            label: t('agentInput.quickActions.releaseGuard.title'),
            description: t('agentInput.quickActions.releaseGuard.description'),
            prompt: t('agentInput.quickActions.releaseGuard.prompt'),
            icon: 'shield-checkmark-outline',
        },
        {
            key: 'evidenceReport',
            label: t('agentInput.quickActions.evidenceReport.title'),
            description: t('agentInput.quickActions.evidenceReport.description'),
            prompt: t('agentInput.quickActions.evidenceReport.prompt'),
            icon: 'image-outline',
        },
    ], [sessionProjectPath, resolveTaskBriefPrompt]);
    const quickActions = React.useMemo<AgentQuickAction[]>(() => {
        if (customQuickActions.length === 0) return defaultQuickActions;
        return customQuickActions.map((action, index) => ({
            key: `custom-${index}`,
            label: action.label,
            description: action.description ?? '',
            prompt: applyQuickActionPlaceholders(action.prompt, { projectPath: sessionProjectPath }),
            resolvePrompt: isCustomTaskBriefAction(action, defaultQuickActions[0]) ? resolveTaskBriefPrompt : undefined,
            icon: action.icon ?? 'sparkles-outline',
        }));
    }, [customQuickActions, defaultQuickActions, sessionProjectPath, resolveTaskBriefPrompt]);
    const handleCustomizeQuickActions = React.useCallback(async () => {
        const editableActions = customQuickActions.length > 0
            ? customQuickActions
            : defaultQuickActions.map((action) => ({
                label: action.label,
                description: action.description,
                prompt: action.prompt.replaceAll(sessionProjectPath, '{{projectPath}}'),
                icon: action.icon,
            }));
        const raw = await Modal.prompt(
            t('agentInput.quickActions.customizeTitle'),
            t('agentInput.quickActions.customizePrompt'),
            {
                defaultValue: JSON.stringify(editableActions, null, 2),
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
                multiline: true,
                multilineRows: 22,
                size: 'large',
            },
        );
        if (raw === null) return;
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '[]') {
            setCustomQuickActions([]);
            setLegacyLocalCustomQuickActions([]);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            const result = CustomQuickActionSchema.array().safeParse(parsed);
            if (!result.success) {
                Modal.alert(t('common.error'), t('agentInput.quickActions.customizeInvalid'));
                return;
            }
            setCustomQuickActions(result.data.map((action) => ({
                label: action.label.trim(),
                description: action.description?.trim() ?? '',
                prompt: action.prompt.trim(),
                icon: action.icon?.trim() || undefined,
            })));
            setLegacyLocalCustomQuickActions([]);
        } catch {
            Modal.alert(t('common.error'), t('agentInput.quickActions.customizeInvalid'));
        }
    }, [customQuickActions, defaultQuickActions, sessionProjectPath, setCustomQuickActions, setLegacyLocalCustomQuickActions]);

    // Pill toggle in the status row: archive when active, resume when archived.
    // Both flows confirm via Modal first, so an accidental tap is recoverable.
    const { handleArchive, archiveOverlay } = useArchiveSession(session);
    const { handleResume, isResuming } = useResumeSession(session);
    // Same-agent copy reuses useResumeSession.handleResume (it copies when the
    // session is active). Gate on the same forkable metadata the hook requires
    // so the model-panel "copy session" row never renders as a dead tap target.
    const canCopySession = !!(
        (session.metadata?.claudeSessionId || session.metadata?.flavor === 'gemini' || session.metadata?.codexSessionId)
        && session.metadata?.path
        && session.metadata?.machineId
    );
    const [, performDeleteSession] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
        storage.getState().deleteSession(session.id);
        if (Platform.OS === 'web') {
            router.replace('/');
        } else {
            router.back();
        }
    }, { timeoutMs: 35_000 });

    const handleDeleteSession = React.useCallback(() => {
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDeleteSession,
                },
            ],
        );
    }, [performDeleteSession]);

    const copySessionToAgent = React.useCallback(async (targetAgent: CopyTargetAgent) => {
        const sessionPath = session.metadata?.path;
        if (!machineId || !sessionPath) {
            throw new HappyError(t('duplicate.notAvailable'), false);
        }

        const targetProvider = formatCopyTargetAgent(targetAgent);
        const newSessionTitle = `${getSessionName(session)} (${targetProvider})`;
        const spawnResult = await machineSpawnNewSession({
            machineId,
            directory: sessionPath,
            agent: targetAgent,
            sessionTitle: newSessionTitle,
        });

        if (spawnResult.type !== 'success' || !spawnResult.sessionId) {
            throw new HappyError(
                spawnResult.type === 'error' ? spawnResult.errorMessage : t('duplicate.failed'),
                false,
            );
        }

        await sync.refreshSessions();
        await copySessionMetadata(session, spawnResult.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
        sync.queueSessionModeConfigUpdate({
            sessionId: spawnResult.sessionId,
            agentType: targetAgent,
            permissionMode: mapPermissionModeForCopyTarget(permissionMode, targetAgent),
            modelMode: 'default',
            fastMode: false,
            includeSessionEntry: true,
            includeLastUsed: false,
        });

        const sendResult = await sync.sendMessage(spawnResult.sessionId, buildCopyToAgentBriefPrompt({
            sessionId: session.id,
            projectPath: sessionPath,
        }));
        if (!sendResult.success) {
            throw new HappyError(sendResult.error || t('duplicate.failed'), false);
        }
        router.replace(`/session/${spawnResult.sessionId}`);
    }, [machineId, permissionMode, router, session]);

    const [isCopyingToCodexSession, performCopyToCodexSession] = useHappyAction(async () => {
        await copySessionToAgent('codex');
    }, { timeoutMs: 120_000 });

    const [isCopyingToClaudeSession, performCopyToClaudeSession] = useHappyAction(async () => {
        await copySessionToAgent('claude');
    }, { timeoutMs: 120_000 });

    const handleCopyToCodexSession = React.useCallback(async () => {
        if (session.metadata?.flavor === 'codex' || session.metadata?.codexSessionId) return;
        const confirmed = await Modal.confirm(
            t('sessionHistory.copyConfirmTitle'),
            t('sessionHistory.copyConfirmMessage', { provider: 'Codex' }),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        performCopyToCodexSession();
    }, [performCopyToCodexSession, session.metadata?.codexSessionId, session.metadata?.flavor]);

    const handleCopyToClaudeSession = React.useCallback(async () => {
        if (session.metadata?.flavor === 'claude' || session.metadata?.claudeSessionId) return;
        const confirmed = await Modal.confirm(
            t('sessionHistory.copyConfirmTitle'),
            t('sessionHistory.copyConfirmMessage', { provider: 'Claude' }),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        performCopyToClaudeSession();
    }, [performCopyToClaudeSession, session.metadata?.claudeSessionId, session.metadata?.flavor]);

    // Handler for filling the input from option selection
    const handleFillInput = React.useCallback(async (text: string, allOptions?: string[]) => {
        const currentMessage = message.trim();
        if (currentMessage) {
            // Skip confirmation if current input is one of the available options
            const isCurrentInputAnOption = allOptions?.includes(currentMessage);
            if (!isCurrentInputAnOption) {
                const confirmed = await Modal.confirm(
                    t('message.confirmOverwriteInput'),
                    t('message.confirmOverwriteInputMessage'),
                    { confirmText: t('common.yes'), cancelText: t('common.cancel') }
                );
                if (!confirmed) return;
            }
        }
        setMessage(text);
        // Auto-focus input on web platform
        if (Platform.OS === 'web') {
            inputRef.current?.focus();
        }
    }, [message]);

    // Image picker hook for handling image attachments
    const {
        images,
        pickFromGallery,
        pickFromCamera,
        addImageFromUri,
        removeImage,
        clearImages,
        initImages,
        canAddMore,
    } = useImagePicker({ maxImages: 4 });

    // Use draft hook for auto-saving message drafts
    const { clearDraft } = useDraft(sessionId, message, setMessage, images, initImages);

    const [isUploadingImages, setIsUploadingImages] = React.useState(false);
    const [isSending, setIsSending] = React.useState(false);

    // Track failed message for retry with same localId
    const failedMessageRef = React.useRef<{ localId: string; content: string } | null>(null);

    // Duplicate sheet state
    const [duplicateSheetVisible, setDuplicateSheetVisible] = React.useState(false);
    const [duplicateMessages, setDuplicateMessages] = React.useState<UserMessageWithUuid[] | null>(null);
    const [duplicateLoading, setDuplicateLoading] = React.useState(false);
    const [duplicateConfirming, setDuplicateConfirming] = React.useState(false);
    const duplicateProjectIdRef = React.useRef<string | null>(null);

    // Ref for hidden file input (web only)
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Image picker sheet state
    const [imagePickerSheetVisible, setImagePickerSheetVisible] = React.useState(false);

    // Check if the current session flavor supports images
    const supportsImages = React.useMemo(() => {
        const flavor = session?.metadata?.flavor;
        if (flavor) {
            return flavor === 'claude' || flavor === 'gemini' || flavor === 'codex';
        }
        // Older/corrupt metadata may miss `flavor`. Do not pessimistically
        // disable image upload in that case; message delivery can still carry
        // mixed content and the CLI/provider is the final authority.
        return true;
    }, [session?.metadata?.flavor]);

    // Handle dismissing CLI version warning
    const handleDismissCliWarning = React.useCallback(() => {
        if (machineId && cliVersion) {
            storage.getState().applyLocalSettings({
                acknowledgedCliVersions: {
                    ...acknowledgedCliVersions,
                    [machineId]: cliVersion
                }
            });
        }
    }, [machineId, cliVersion, acknowledgedCliVersions]);

    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo') => {
        storage.getState().updateSessionPermissionMode(sessionId, mode);
    }, [sessionId]);

    // Function to update model mode
    const updateModelMode = React.useCallback((mode: string) => {
        storage.getState().updateSessionModelMode(sessionId, mode);
    }, [sessionId]);

    const updateFastMode = React.useCallback((enabled: boolean) => {
        storage.getState().setSessionFastMode(sessionId, enabled);
    }, [sessionId]);

    // Handle opening the duplicate sheet - loads user messages from the session
    const handleOpenDuplicateSheet = React.useCallback(async () => {
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const canDuplicate = Boolean(claudeSessionId || flavor === 'gemini' || codexSessionId);
        if (!machineId || !canDuplicate) {
            Modal.alert(t('common.error'), t('duplicate.notAvailable'));
            return;
        }

        // Blur input to prevent keyboard from re-appearing when the modal closes
        inputRef.current?.blur();

        setDuplicateSheetVisible(true);
        setDuplicateLoading(true);
        setDuplicateMessages(null);

        try {
            if (flavor === 'gemini') {
                const result = await machineGetGeminiSessionUserMessages(machineId, session.id);
                setDuplicateMessages(result.messages);
            } else if (flavor === 'codex' && codexSessionId) {
                const result = await machineGetCodexSessionUserMessages(machineId, codexSessionId);
                setDuplicateMessages(result.messages);
            } else if (claudeSessionId) {
                const result = await machineGetClaudeSessionUserMessages(machineId, claudeSessionId);
                setDuplicateMessages(result.messages);
                duplicateProjectIdRef.current = result.projectId;
            }
        } catch (error) {
            console.error('Failed to load duplicate messages:', error);
            Modal.alert(t('common.error'), t('duplicate.loadFailed'));
            setDuplicateSheetVisible(false);
        } finally {
            setDuplicateLoading(false);
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId]);

    // Handle selecting a message to duplicate from
    const handleDuplicateSelect = React.useCallback(async (uuid: string) => {
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const sessionPath = session.metadata?.path;
        if (!machineId || !sessionPath) return;

        // Start confirming state - keep sheet open with loading button
        setDuplicateConfirming(true);

        try {
            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' = 'claude';

            if (flavor === 'gemini') {
                const duplicateResult = await machineDuplicateGeminiSession(machineId, session.id, uuid);
                if (!duplicateResult.success || !duplicateResult.newSessionId) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const duplicateResult = await machineDuplicateCodexSession(machineId, codexSessionId, uuid);
                if (!duplicateResult.success || !duplicateResult.newFilePath) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const duplicateResult = await machineDuplicateClaudeSession(machineId, claudeSessionId, uuid);
                if (!duplicateResult.success || !duplicateResult.newSessionId) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newSessionId;
                agent = 'claude';
            } else {
                setDuplicateConfirming(false);
                return;
            }

            // Step 2: Spawn a new Happy session that resumes the forked Claude session
            const newSessionTitle = generateCopyTitle(getSessionName(session));

            const spawnResult = await machineSpawnNewSession({
                machineId,
                directory: sessionPath,
                agent,
                resumeSessionId,
                sessionTitle: newSessionTitle,
                skipForkSession: true,
            });

            if (spawnResult.type === 'success' && spawnResult.sessionId) {
                await sync.refreshSessions();
                await copySessionMetadata(session, spawnResult.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
                copySessionModeSettings(session, spawnResult.sessionId);

                // Save the selected message as a draft in the new session so it appears in the input box
                const selectedMessage = duplicateMessages?.find(m => m.uuid === uuid);
                if (selectedMessage?.content) {
                    storage.getState().updateSessionDraft(spawnResult.sessionId, {
                        text: selectedMessage.content,
                        images: [],
                    });
                }

                // Close the sheet and navigate to the new Happy session
                setDuplicateSheetVisible(false);
                setDuplicateConfirming(false);
                router.replace(`/session/${spawnResult.sessionId}`);
            } else if (spawnResult.type === 'error') {
                setDuplicateConfirming(false);
                Modal.alert(t('common.error'), spawnResult.errorMessage || t('duplicate.failed'));
            }
        } catch (error) {
            console.error('Failed to duplicate session:', error);
            setDuplicateConfirming(false);
            Modal.alert(t('common.error'), t('duplicate.failed'));
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.path, session.metadata?.externalContext, session.metadata?.sessionIcon, router, duplicateMessages]);

    // Handle closing the duplicate sheet (prevent closing while confirming)
    const handleCloseDuplicateSheet = React.useCallback(() => {
        if (!duplicateConfirming) {
            setDuplicateSheetVisible(false);
        }
    }, [duplicateConfirming]);

    // Memoize header-dependent styles to prevent re-renders
    const headerDependentStyles = React.useMemo(() => ({
        contentContainer: {
            flex: 1
        },
        flatListStyle: {
            marginTop: 0 // No marginTop needed since header is handled by parent
        },
    }), []);


    // Handle microphone button press - memoized to prevent button flashing
    const handleMicrophonePress = React.useCallback(async () => {
        if (realtimeStatus === 'connecting') {
            return; // Prevent actions during transitions
        }
        if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
            try {
                const initialPrompt = voiceHooks.onVoiceStarted(sessionId);
                await startRealtimeSession(sessionId, initialPrompt);
                tracking?.capture('voice_session_started', { sessionId });
            } catch (error) {
                console.error('Failed to start realtime session:', error);
                Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
                tracking?.capture('voice_session_error', { error: error instanceof Error ? error.message : 'Unknown error' });
            }
        } else if (realtimeStatus === 'connected') {
            // On web/desktop, stop session from mic button; on mobile, use the status bar
            if (Platform.OS === 'web') {
                await stopRealtimeSession();
                tracking?.capture('voice_session_stopped');
                voiceHooks.onVoiceStopped();
            }
        }
    }, [realtimeStatus, sessionId]);

    // Memoize mic button state to prevent flashing during chat transitions
    const micButtonState = useMemo(() => ({
        onMicPress: handleMicrophonePress,
        isMicActive: realtimeStatus === 'connected' || realtimeStatus === 'connecting'
    }), [handleMicrophonePress, realtimeStatus]);

    // Handle image button press - platform-specific behavior
    const handleImageButtonPress = React.useCallback(() => {
        if (Platform.OS === 'web') {
            // Web: directly open file picker
            fileInputRef.current?.click();
        } else {
            // Native: show action sheet with camera and gallery options
            setImagePickerSheetVisible(true);
        }
    }, []);

    // Image picker sheet menu items
    const imagePickerMenuItems: ActionMenuItem[] = React.useMemo(() => [
        { label: t('session.takePhoto'), onPress: pickFromCamera },
        { label: t('session.chooseFromLibrary'), onPress: pickFromGallery },
    ], [pickFromCamera, pickFromGallery]);

    // Handle file input change (web only)
    const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                const url = URL.createObjectURL(file);
                addImageFromUri(url, file.type);
            }
        });

        // Reset input so same file can be selected again
        event.target.value = '';
    }, [addImageFromUri]);

    // Handle paste event for images (both web and native through input)
    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleImagePasteEvent(event, {
            isScreenFocused: isFocused,
            canAddMore,
            supportsImages,
            onImageFile: async (file, mimeType) => {
                const url = URL.createObjectURL(file);
                await addImageFromUri(url, mimeType);
            },
        });
    }, [isFocused, canAddMore, supportsImages, addImageFromUri]);

    // Handle image drop (web only) - passed to AgentInput
    const handleImageDrop = React.useCallback(async (files: File[]) => {
        if (!canAddMore || !supportsImages) return;

        for (const file of files) {
            if (file.type.startsWith('image/') && canAddMore) {
                const url = URL.createObjectURL(file);
                await addImageFromUri(url, file.type);
            }
        }
    }, [canAddMore, supportsImages, addImageFromUri]);

    // Handle loading more older messages when scrolling to top
    const handleLoadMore = React.useCallback(() => {
        return sync.fetchOlderMessages(sessionId);
    }, [sessionId]);

    // Trigger refresh whenever this session screen gets focus.
    useFocusEffect(
        React.useCallback(() => {
            sync.onSessionVisible(sessionId, true);
            startSilentRefreshTracking();
            void sync.refreshSessions().catch(() => {
                // Silent refresh indicator handles delayed feedback if status stays stale.
            });
        }, [sessionId, startSilentRefreshTracking])
    );

    // Add paste event listener for images (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const pasteListener = (e: Event) => handlePaste(e as ClipboardEvent);
        document.addEventListener('paste', pasteListener);

        return () => {
            document.removeEventListener('paste', pasteListener);
        };
    }, [handlePaste]);

    let content = (
        <>
            <Deferred>
                {messages.length > 0 && (
                    <ChatList session={session} onFillInput={handleFillInput} onLoadMore={handleLoadMore} />
                )}
            </Deferred>
        </>
    );
    const placeholder = messages.length === 0 ? (
        <>
            {isLoaded ? (
                <EmptyMessages session={session} />
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </>
    ) : null;

    const canEdit = !session.accessLevel || session.accessLevel !== 'view';

    const handleSendNowPending = React.useCallback(async (pendingId: string) => {
        if (pendingMessages.length > 1) {
            const batchPrompt = buildPendingQueueBatchPrompt(pendingMessages, pendingId);
            const result = await sync.sendOrQueueMessage(sessionId, batchPrompt);
            if (!result.success) {
                Modal.alert(t('common.error'), t('status.operationFailed'));
                return;
            }

            await Promise.all(pendingMessages.map((message) => sync.deletePendingMessage(sessionId, message.id)));
            try {
                await sessionAbort(sessionId);
            } catch {
                // If the current turn has already ended or the runtime is offline, abort can fail.
                // The batch message is already queued; don't show a false failure.
            }
            return;
        }

        // Pin the message so it becomes the next to dispatch (pinnedAt desc ordering),
        // then abort the current turn — the server auto-dispatches the first pending message.
        const success = await sync.pinPendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
            return;
        }

        try {
            await sessionAbort(sessionId);
        } catch {
            // If the current turn has already ended or the runtime is offline, abort can fail.
            // The send-now action already pinned the pending message; don't show a false failure.
        }
    }, [pendingMessages, sessionId]);

    const handlePinPending = React.useCallback(async (pendingId: string) => {
        const success = await sync.pinPendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const handleDeletePending = React.useCallback(async (pendingId: string) => {
        const success = await sync.deletePendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const pendingQueuePanel = pendingMessages.length > 0 ? (
        <PendingQueuePanel
            messages={pendingMessages}
            canManage={canEdit}
            onSendNow={handleSendNowPending}
            onPin={handlePinPending}
            onDelete={handleDeletePending}
        />
    ) : null;

    const agentInput = canEdit ? (
        <AgentInput
            ref={inputRef}
            placeholder={t('session.inputPlaceholder')}
            value={message}
            onChangeText={setMessage}
            sessionId={sessionId}
            permissionMode={permissionMode}
            onPermissionModeChange={updatePermissionMode}
            modelMode={modelMode as any}
            onModelModeChange={updateModelMode as any}
            fastMode={fastMode}
            onFastModeChange={updateFastMode}
            metadata={session.metadata}
            onArchive={session.active ? handleArchive : undefined}
            onResume={!session.active ? handleResume : undefined}
            onDeleteSession={!session.active ? handleDeleteSession : undefined}
            onCopyToCodexSession={session.metadata?.flavor !== 'codex' && !session.metadata?.codexSessionId ? handleCopyToCodexSession : undefined}
            isCopyingToCodexSession={isCopyingToCodexSession}
            onCopyToClaudeSession={session.metadata?.flavor !== 'claude' && !session.metadata?.claudeSessionId ? handleCopyToClaudeSession : undefined}
            isCopyingToClaudeSession={isCopyingToClaudeSession}
            onCopySession={session.active && canCopySession ? handleResume : undefined}
            isCopyingSession={isResuming}
            connectionStatus={inputConnectionStatus}
            onSend={async (textSnapshot) => {
                // Block sending during CLI upgrade
                if (session.upgrading) {
                    Modal.alert(
                        t('sessionInfo.cliUpgradeAvailable'),
                        t('sessionInfo.cliUpgradeSendBlocked')
                    );
                    return;
                }

                const messageToSend = (textSnapshot ?? message).trim();
                if (messageToSend || images.length > 0) {
                    const socketStatus = storage.getState().socketStatus;
                    log.log(`[SEND_DEBUG][UI] tap_send sid=${sessionId} hasText=${messageToSend.length > 0} images=${images.length} isSending=${isSending} socket=${socketStatus}`);

                    // Handle /duplicate command locally
                    if (messageToSend.toLowerCase() === '/duplicate') {
                        setMessage('');
                        clearDraft();
                        handleOpenDuplicateSheet();
                        return;
                    }

                    const imagesToSend = images.length > 0 ? [...images] : undefined;
                    const contentForRetry = messageToSend + JSON.stringify(imagesToSend || []);

                    // Check if this is a retry of the same content
                    const existingLocalId = failedMessageRef.current?.content === contentForRetry
                        ? failedMessageRef.current.localId
                        : undefined;

                    // Set sending state
                    setIsSending(true);
                    if (imagesToSend) {
                        setIsUploadingImages(true);
                    }

                    try {
                        const result = await sync.sendOrQueueMessage(
                            sessionId, messageToSend, undefined, imagesToSend, existingLocalId,
                            // Clear input before message appears in the list
                            () => {
                                setMessage('');
                                clearDraft();
                                clearImages();
                            }
                        );
                        const mode = result.success ? result.mode : 'failed';
                        const errorText = result.success ? 'none' : (result.error || 'none');
                        log.log(`[SEND_DEBUG][UI] send_result sid=${sessionId} success=${result.success} mode=${mode} localId=${result.localId} error=${errorText}`);

                        if (result.success) {
                            failedMessageRef.current = null;
                            trackMessageSent();
                        } else {
                            failedMessageRef.current = { localId: result.localId, content: contentForRetry };
                            log.log(`[SEND_DEBUG][UI] record_retry sid=${sessionId} localId=${result.localId}`);
                        }
                    } finally {
                        setIsSending(false);
                        setIsUploadingImages(false);
                    }
                }
            }}
            isSending={isSending}
            onMicPress={micButtonState.onMicPress}
            isMicActive={micButtonState.isMicActive}
            onAbort={() => {
                Modal.alert(
                    t('session.abortConfirmTitle'),
                    t('session.abortConfirmMessage'),
                    [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                            text: t('session.abortConfirmAction'),
                            style: 'destructive',
                            onPress: () => sessionAbort(sessionId),
                        },
                    ],
                );
            }}
            showAbortButton={sessionStatus.state === 'thinking' || sessionStatus.state === 'waiting'}
            onFileViewerPress={() => {
                if (isDesktopPanelMode) {
                    setRightPanelType(prev => (prev === 'files' ? null : 'files'));
                } else {
                    router.push(`/session/${sessionId}/files`);
                }
            }}
            // Autocomplete configuration
            autocompletePrefixes={['@', '/', '$']}
            autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
            usageData={sessionUsage ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize,
                contextWindowSize: sessionUsage.contextWindowSize,
            } : session.latestUsage ? {
                inputTokens: session.latestUsage.inputTokens,
                outputTokens: session.latestUsage.outputTokens,
                cacheCreation: session.latestUsage.cacheCreation,
                cacheRead: session.latestUsage.cacheRead,
                contextSize: session.latestUsage.contextSize,
                contextWindowSize: session.latestUsage.contextWindowSize,
            } : undefined}
            alwaysShowContextSize={alwaysShowContextSize}
            images={images}
            onImagesChange={(newImages) => {
                // Handle image removal by finding removed index
                // Since useImagePicker manages state, we call removeImage for each removed image
                const currentUris = new Set(newImages.map(img => img.uri));
                images.forEach((img, index) => {
                    if (!currentUris.has(img.uri)) {
                        removeImage(index);
                    }
                });
            }}
            onImageButtonPress={handleImageButtonPress}
            supportsImages={supportsImages}
            isUploadingImages={isUploadingImages}
            onImageDrop={handleImageDrop}
            quickActions={quickActions}
            onCustomizeQuickActions={handleCustomizeQuickActions}
        />
    ) : null;

    const input = agentInput;


    return (
        <>
            {/* Hidden file input for web image upload */}
            {Platform.OS === 'web' && (
                <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange as any}
                />
            )}


            {/* CLI Version Warning Overlay - Subtle centered pill */}
            {shouldShowCliWarning && !(isLandscape && deviceType === 'phone') && (
                <Pressable
                    onPress={handleDismissCliWarning}
                    style={{
                        position: 'absolute',
                        top: 8, // Position at top of content area (padding handled by parent)
                        alignSelf: 'center',
                        backgroundColor: '#FFF3CD',
                        borderRadius: 100, // Fully rounded pill
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        zIndex: 998, // Below voice bar but above content
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 4,
                        elevation: 4,
                    }}
                >
                    <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
                    <Text style={{
                        fontSize: 12,
                        color: '#856404',
                        fontWeight: '600'
                    }}>
                        {t('sessionInfo.cliVersionOutdated')}
                    </Text>
                    <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
                </Pressable>
            )}

            {/* Main content area - no padding since header is overlay */}
            <View style={{ flexBasis: 0, flexGrow: 1, flexDirection: 'row', minWidth: 0 }}>
                <View style={{ flex: 1, minWidth: 0, paddingBottom: safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 32 : 0) }}>
                    <AgentContentView
                        content={content}
                        input={input}
                        placeholder={placeholder}
                        betweenContentAndInput={pendingQueuePanel}
                    />
                </View>
                <TerminalPanel
                    visible={showTerminal}
                    onClose={() => setShowTerminal(false)}
                    sessionId={sessionId}
                    cwd={session.metadata?.path}
                />
            </View >

            {/* Back button for landscape phone mode when header is hidden */}
            {
                isLandscape && deviceType === 'phone' && (
                    <Pressable
                        onPress={() => router.back()}
                        style={{
                            position: 'absolute',
                            top: safeArea.top + 8,
                            left: 16,
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 2 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 4,
                                },
                                android: {
                                    elevation: 2,
                                }
                            }),
                        }}
                        hitSlop={15}
                    >
                        <Ionicons
                            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                            size={Platform.select({ ios: 28, default: 24 })}
                            color="#000"
                        />
                    </Pressable>
                )
            }

            {/* Duplicate Sheet */}
            <DuplicateSheet
                visible={duplicateSheetVisible}
                messages={duplicateMessages}
                loading={duplicateLoading}
                confirming={duplicateConfirming}
                onClose={handleCloseDuplicateSheet}
                onSelect={handleDuplicateSelect}
            />

            {/* Image Picker Sheet */}
            <ActionMenuModal
                visible={imagePickerSheetVisible}
                items={imagePickerMenuItems}
                onClose={() => setImagePickerSheetVisible(false)}
                deferItemPress
            />

            {/* Worktree-aware archive confirmation menu (used by useArchiveSession) */}
            {archiveOverlay}

            <FileViewerModal
                visible={showFileViewer}
                onClose={() => setShowFileViewer(false)}
                sessionId={sessionId}
                initialCwd={session.metadata?.path}
            />
        </>
    )
}
