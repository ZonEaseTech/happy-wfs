import React from 'react';
import { View, Pressable, FlatList, Platform, RefreshControl, TextInput, ScrollView, Linking } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem, useLocalSettingMutable, useSetting, useOrchestratorRunningTaskCount } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisibleSessionListViewData, useInactiveSessionListViewData, useSharedSessionListViewData, useSharedByMeSessionListViewData, useClosureSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { Item } from './Item';
import { ItemGroup } from './ItemGroup';
import { useHappyAction } from '@/hooks/useHappyAction';
import { sessionDelete } from '@/sync/ops';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { useAuth } from '@/auth/AuthContext';
import { listGitHubIssues, saveGitHubToken, type GitHubIssue } from '@/sync/apiGithub';
import { storeTempData } from '@/utils/tempDataStore';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 45,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemCompact: {
        height: 45,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemContainer: {
        marginHorizontal: 16,
        overflow: 'hidden',
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleCompact: {
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
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    taskStatusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 4,
        height: 16,
        borderRadius: 4,
    },
    taskStatusText: {
        fontSize: 10,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    statusIndicatorsRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        transform: [{ translateY: 1 }],
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 80, // 16px paddingHorizontal + 48px avatar + 16px gap
    },
    filterRow: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 0,
    },
    filterChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    filterChipText: {
        fontSize: 13,
        ...Typography.default(),
    },
    pendingSearchSection: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        gap: 8,
    },
    pendingSearchBox: {
        minHeight: 40,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    pendingSearchInput: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
    pendingProjectFilterButton: {
        minHeight: 36,
        borderRadius: 12,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    pendingProjectFilterText: {
        flex: 1,
        marginLeft: 8,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueItem: {
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        marginHorizontal: 16,
        marginBottom: 8,
    },
    issueContent: {
        flex: 1,
        marginLeft: 12,
    },
    issueRepo: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueTitle: {
        fontSize: 15,
        color: theme.colors.text,
        marginTop: 3,
        ...Typography.default('semiBold'),
    },
    issueMeta: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
        ...Typography.default(),
    },
    issueDetailModal: {
        width: 860,
        maxWidth: '96%',
        maxHeight: '92%',
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
    },
    issueDetailHeader: {
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    issueDetailRepo: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueDetailTitle: {
        marginTop: 6,
        fontSize: 18,
        lineHeight: 24,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    issueDetailBody: {
        paddingHorizontal: 18,
        paddingVertical: 14,
        maxHeight: 660,
    },
    issueDetailBodyText: {
        fontSize: 14,
        lineHeight: 21,
        color: theme.colors.text,
        ...Typography.default(),
    },
    issueDetailActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        minHeight: 52,
    },
    issueDetailAction: {
        flex: 1,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
    },
    issueDetailActionSeparator: {
        width: 1,
        backgroundColor: theme.colors.divider,
    },
    issueDetailActionText: {
        fontSize: 16,
        color: theme.colors.textLink,
        ...Typography.default('semiBold'),
    },
    emptyContainer: {
        alignItems: 'center',
        paddingTop: 80,
        paddingHorizontal: 48,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));

type SessionTab = 'active' | 'closure' | 'inactive' | 'shared' | 'sharedByMe';
type SidebarTab = 'pending' | SessionTab;

// Persists selected tab across navigation (survives component unmount/remount)
let lastActiveTab: SidebarTab = 'active';

function splitGitHubIssueFilterValues(value: string | undefined): string[] {
    return (value ?? '')
        .split(/[\n,，]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function formatGitHubIssueFilterConfig(filters: { projects?: string; keywords?: string } | undefined): string {
    return [
        `项目：${filters?.projects?.trim() ?? ''}`,
        `状态：${filters?.keywords?.trim() ?? ''}`,
    ].join('\n');
}

function stripGitHubIssueFilterPrefix(line: string, prefixes: string[]): string {
    const normalized = line.trim();
    for (const prefix of prefixes) {
        const match = normalized.match(new RegExp(`^${prefix}\\s*[:：=]\\s*(.*)$`, 'i'));
        if (match) return match[1]?.trim() ?? '';
    }
    return normalized;
}

function parseGitHubIssueFilterConfig(value: string): { projects: string; keywords: string } {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const projectLines: string[] = [];
    const keywordLines: string[] = [];
    const freeLines: string[] = [];

    for (const line of lines) {
        if (/^(project|projects|项目|專案)\s*[:：=]/i.test(line)) {
            projectLines.push(stripGitHubIssueFilterPrefix(line, ['project', 'projects', '项目', '專案']));
        } else if (/^(status|statuses|state|title|keyword|keywords|状态|狀態|标题|標題|关键词|關鍵詞)\s*[:：=]/i.test(line)) {
            keywordLines.push(stripGitHubIssueFilterPrefix(line, ['status', 'statuses', 'state', 'title', 'keyword', 'keywords', '状态', '狀態', '标题', '標題', '关键词', '關鍵詞']));
        } else {
            freeLines.push(line);
        }
    }

    // Backward-friendly shorthand:
    // - One unlabelled line means project name (the old dialog behavior).
    // - Two+ unlabelled lines mean first line project, remaining lines status/title keywords.
    if (freeLines.length > 0) {
        if (projectLines.length === 0) {
            projectLines.push(freeLines[0]!);
            keywordLines.push(...freeLines.slice(1));
        } else {
            keywordLines.push(...freeLines);
        }
    }

    return {
        projects: projectLines.filter(Boolean).join('\n').trim(),
        keywords: keywordLines.filter(Boolean).join('\n').trim(),
    };
}

function buildGitHubIssueSearchQuery(searchText: string): string {
    const clauses = ['is:issue', 'is:open', 'assignee:@me', 'archived:false'];
    const search = searchText.trim();
    if (!search) return clauses.join(' ');

    const issueNumber = search.match(/^#\s*(\d+)$/)?.[1] ?? search.match(/^(\d+)$/)?.[1];
    clauses.push(issueNumber ?? search);
    return clauses.join(' ');
}

function isGitHubBadCredentialsMessage(message: string | undefined | null): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return normalized.includes('bad credentials')
        || normalized.includes('status 401')
        || normalized.includes('responded with 401')
        || normalized.includes('insufficient_scopes')
        || normalized.includes('required scopes')
        || normalized.includes('read:project');
}

export function SessionsList() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const data = useVisibleSessionListViewData();
    const inactiveData = useInactiveSessionListViewData();
    const closureData = useClosureSessionListViewData();
    const sharedData = useSharedSessionListViewData();
    const sharedByMeData = useSharedByMeSessionListViewData();
    const [activeTab, _setActiveTab] = React.useState<SidebarTab>(lastActiveTab);
    const setActiveTab = React.useCallback((tab: SidebarTab) => {
        lastActiveTab = tab;
        _setActiveTab(tab);
    }, []);
    const auth = useAuth();
    const [pendingIssues, setPendingIssues] = React.useState<GitHubIssue[]>([]);
    const [pendingIssuesLoading, setPendingIssuesLoading] = React.useState(false);
    const [pendingIssuesError, setPendingIssuesError] = React.useState<string | null>(null);
    const [githubIssueInboxFilters, setGithubIssueInboxFilters] = useLocalSettingMutable('githubIssueInboxFilters');
    const [pendingIssueSearchText, setPendingIssueSearchText] = React.useState('');
    const lastPendingIssuesLoadKeyRef = React.useRef<string | null>(null);
    const githubTokenPromptOpenRef = React.useRef(false);
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const navigateToSession = useNavigateToSession();
    const compactSessionView = useSetting('compactSessionView');
    const router = useRouter();
    const { theme } = useUnistyles();
    const [refreshing, setRefreshing] = React.useState(false);
    const pendingIssueServerQuery = React.useMemo(() => buildGitHubIssueSearchQuery(pendingIssueSearchText), [pendingIssueSearchText]);
    const promptForGitHubToken = React.useCallback(async (): Promise<boolean> => {
        if (!auth.credentials || githubTokenPromptOpenRef.current) return false;
        githubTokenPromptOpenRef.current = true;
        try {
            const token = await Modal.prompt(
                'GitHub token 已失效',
                'GitHub 返回 Bad credentials。请输入新的 Personal Access Token（需要 repo / read:org / read:project 权限），保存后会自动重试读取 Issues。',
                {
                    placeholder: 'github_pat_...',
                    inputType: 'secure-text',
                    confirmText: '保存',
                    cancelText: t('common.cancel'),
                },
            );
            const trimmed = token?.trim();
            if (!trimmed) return false;
            await saveGitHubToken(auth.credentials, trimmed);
            await sync.refreshProfile().catch(() => undefined);
            lastPendingIssuesLoadKeyRef.current = null;
            return true;
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : 'GitHub token 保存失败',
            );
            return false;
        } finally {
            githubTokenPromptOpenRef.current = false;
        }
    }, [auth.credentials]);
    const loadPendingIssues = React.useCallback(async (showSpinner: boolean = true) => {
        if (!auth.credentials) return;
        if (showSpinner) setPendingIssuesLoading(true);
        setPendingIssuesError(null);
        const requestOptions = {
            limit: 100,
            query: pendingIssueServerQuery,
            projects: githubIssueInboxFilters.projects,
            statuses: githubIssueInboxFilters.keywords,
        };
        try {
            let result = await listGitHubIssues(auth.credentials, requestOptions);
            if (isGitHubBadCredentialsMessage(result.warning)) {
                setPendingIssuesError(result.warning ?? null);
                const saved = await promptForGitHubToken();
                if (saved) {
                    result = await listGitHubIssues(auth.credentials, requestOptions);
                }
            }
            setPendingIssues(result.issues);
            if (result.warning) {
                setPendingIssuesError(result.warning);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setPendingIssuesError(message);
            if (isGitHubBadCredentialsMessage(message)) {
                const saved = await promptForGitHubToken();
                if (saved) {
                    const result = await listGitHubIssues(auth.credentials, requestOptions);
                    setPendingIssues(result.issues);
                    setPendingIssuesError(result.warning ?? null);
                }
            }
        } finally {
            setPendingIssuesLoading(false);
        }
    }, [auth.credentials, githubIssueInboxFilters.keywords, githubIssueInboxFilters.projects, pendingIssueServerQuery, promptForGitHubToken]);
    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            if (activeTab === 'pending') {
                await loadPendingIssues(false);
                return;
            }
            await sync.refreshSessions();
        } finally {
            setRefreshing(false);
        }
    }, [activeTab, loadPendingIssues]);

    React.useEffect(() => {
        if (activeTab !== 'pending') return;
        const loadKey = `${auth.credentials?.token ?? ''}:${pendingIssueServerQuery}:${githubIssueInboxFilters.projects ?? ''}:${githubIssueInboxFilters.keywords ?? ''}`;
        if (lastPendingIssuesLoadKeyRef.current === loadKey) return;
        lastPendingIssuesLoadKeyRef.current = loadKey;
        const timeout = setTimeout(() => {
            void loadPendingIssues();
        }, pendingIssueSearchText.trim() ? 350 : 0);
        return () => clearTimeout(timeout);
    }, [activeTab, auth.credentials?.token, githubIssueInboxFilters.keywords, githubIssueInboxFilters.projects, pendingIssueSearchText, pendingIssueServerQuery, loadPendingIssues]);
    const pendingIssueFilterKeywords = React.useMemo(() => {
        return splitGitHubIssueFilterValues(githubIssueInboxFilters.keywords);
    }, [githubIssueInboxFilters.keywords]);
    const pendingIssueProjectFilters = React.useMemo(() => {
        return splitGitHubIssueFilterValues(githubIssueInboxFilters.projects);
    }, [githubIssueInboxFilters.projects]);
    const pendingIssueSearchNumber = React.useMemo(() => {
        const trimmed = pendingIssueSearchText.trim();
        const value = trimmed.match(/^#\s*(\d+)$/)?.[1] ?? trimmed.match(/^(\d+)$/)?.[1];
        return value ? Number(value) : null;
    }, [pendingIssueSearchText]);
    const pendingIssueSearchKeyword = React.useMemo(() => pendingIssueSearchText.trim().replace(/^#\s*/, '').toLowerCase(), [pendingIssueSearchText]);
    const filteredPendingIssues = React.useMemo(() => {
        return pendingIssues.filter((issue) => {
            const haystack = [
                issue.repository,
                `#${issue.number}`,
                String(issue.number),
                issue.title,
                issue.body ?? '',
                ...issue.labels,
                ...issue.projectStatuses,
                ...issue.projectTitles,
            ].join('\n').toLowerCase();
            if (pendingIssueSearchNumber !== null && issue.number !== pendingIssueSearchNumber) {
                return false;
            }
            if (pendingIssueSearchNumber === null && pendingIssueSearchKeyword && !haystack.includes(pendingIssueSearchKeyword)) {
                return false;
            }
            if (pendingIssueProjectFilters.length > 0) {
                const projectHaystack = issue.projectTitles.join('\n').toLowerCase();
                if (!pendingIssueProjectFilters.some((keyword) => projectHaystack.includes(keyword))) {
                    return false;
                }
            }
            if (pendingIssueFilterKeywords.length > 0 && !pendingIssueFilterKeywords.some((keyword) => haystack.includes(keyword))) {
                return false;
            }
            return true;
        });
    }, [pendingIssues, pendingIssueFilterKeywords, pendingIssueProjectFilters, pendingIssueSearchKeyword, pendingIssueSearchNumber]);
    // Reset to 'active' tab if current tab's data becomes empty.
    // Closure tab is exempt — it's an affordance (the user needs to see
    // *where* to mark sessions for closure), so it stays visible and
    // selectable even when empty.
    React.useEffect(() => {
        if (activeTab === 'inactive' && inactiveData && inactiveData.length === 0) {
            setActiveTab('active');
        }
        if (activeTab === 'shared' && sharedData && sharedData.length === 0) {
            setActiveTab('active');
        }
        if (activeTab === 'sharedByMe' && sharedByMeData && sharedByMeData.length === 0) {
            setActiveTab('active');
        }
    }, [activeTab, inactiveData, sharedData, sharedByMeData]);

    const tabData = activeTab === 'inactive' ? inactiveData
        : activeTab === 'closure' ? closureData
        : activeTab === 'shared' ? sharedData
        : activeTab === 'sharedByMe' ? sharedByMeData
        : data;

    const selectable = isTablet;
    const dataWithSelected = selectable ? React.useMemo(() => {
        return tabData?.map(item => ({
            ...item,
            selected: pathname.startsWith(`/session/${item.type === 'session' ? item.session.id : ''}`)
        }));
    }, [tabData, pathname]) : tabData;

    // Request review
    React.useEffect(() => {
        if (data && data.length > 0) {
            requestReview();
        }
    }, [data && data.length > 0]);

    // Early return if no data yet
    if (!data) {
        return (
            <View style={styles.container} />
        );
    }

    const keyExtractor = React.useCallback((item: SessionListViewItem & { selected?: boolean }, index: number) => {
        switch (item.type) {
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item, index }: { item: SessionListViewItem & { selected?: boolean }, index: number }) => {
        switch (item.type) {
            case 'header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                // Extract just the session ID from pathname (e.g., /session/abc123/file -> abc123)
                let selectedId: string | undefined;
                if (isTablet && pathname.startsWith('/session/')) {
                    const parts = pathname.split('/');
                    selectedId = parts[2]; // parts[0] is empty, parts[1] is 'session', parts[2] is the ID
                }

                const ActiveComponent = compactSessionView ? ActiveSessionsGroupCompact : ActiveSessionsGroup;
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                return (
                    <SessionItem
                        session={item.session}
                        selected={item.selected}
                        isFirst={isFirst}
                        isLast={isLast}
                        isSingle={isSingle}
                    />
                );
        }
    }, [pathname, dataWithSelected, compactSessionView]);


    // Remove this section as we'll use FlatList for all items now


    const handleStartIssue = React.useCallback((issue: GitHubIssue) => {
        const body = issue.body?.trim();
        const bodyForPrompt = body && body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body;
        const prompt = [
            `请开始处理这个 GitHub Issue：`,
            ``,
            `- 仓库：${issue.repository}`,
            `- Issue：#${issue.number} ${issue.title}`,
            `- 链接：${issue.htmlUrl}`,
            bodyForPrompt ? `\nIssue 内容：\n${bodyForPrompt}` : '',
            ``,
            `执行要求：`,
            `1. 先用 gh / GitHub 工具读取 issue 最新描述、评论和相关上下文。`,
            `2. 基于本地仓库完成修复或实现。`,
            `3. 保留已有用户改动，完成后运行必要验证。`,
            `4. 汇报改动、验证结果和后续发布建议。`,
        ].filter(Boolean).join('\n');
        const dataId = storeTempData({
            prompt,
            agentType: 'codex',
            sessionType: 'worktree',
            sessionTitle: `#${issue.number} ${issue.title}`,
            sessionIcon: '🐙',
            externalContext: {
                source: 'github',
                sourceUrl: issue.htmlUrl,
                resourceType: 'issue',
                resourceId: `${issue.repository}#${issue.number}`,
                title: `#${issue.number} ${issue.title}`,
                deepLink: issue.htmlUrl,
                extra: {
                    repository: issue.repository,
                    number: issue.number,
                    labels: issue.labels,
                },
            },
        });
        router.push(`/new?dataId=${encodeURIComponent(dataId)}`);
    }, [router]);
    const handleOpenIssueDetails = React.useCallback((issue: GitHubIssue) => {
        Modal.show({
            component: GitHubIssueDetailModal,
            props: {
                issue,
                onStart: () => handleStartIssue(issue),
            },
        });
    }, [handleStartIssue]);

    const renderPendingIssue = React.useCallback(({ item }: { item: GitHubIssue }) => (
        <GitHubIssueItem issue={item} onPress={handleOpenIssueDetails} />
    ), [handleOpenIssueDetails]);
    const handleConfigurePending = React.useCallback(async () => {
        const value = await Modal.prompt(
            'GitHub Issues 过滤',
            '同时配置 GitHub Project 和状态/标题过滤。示例：\n项目：TTPOS\n状态：Todo\n留空显示全部。',
            {
                defaultValue: formatGitHubIssueFilterConfig(githubIssueInboxFilters),
                placeholder: '项目：TTPOS\n状态：Todo',
                confirmText: '保存',
                cancelText: t('common.cancel'),
                inputType: 'default',
                multiline: true,
                multilineRows: 5,
                size: 'large',
            },
        );
        if (value === null) return;
        lastPendingIssuesLoadKeyRef.current = null;
        setGithubIssueInboxFilters(parseGitHubIssueFilterConfig(value));
    }, [githubIssueInboxFilters.keywords, githubIssueInboxFilters.projects, setGithubIssueInboxFilters]);
    const projectFilterLabel = React.useMemo(() => {
        const projects = splitGitHubIssueFilterValues(githubIssueInboxFilters.projects);
        const keywords = splitGitHubIssueFilterValues(githubIssueInboxFilters.keywords);
        const parts = [
            projects.length > 0 ? `项目：${projects.join(' / ')}` : '项目：全部',
            keywords.length > 0 ? `状态/标题：${keywords.join(' / ')}` : null,
        ].filter(Boolean);
        return parts.join(' · ');
    }, [githubIssueInboxFilters.keywords, githubIssueInboxFilters.projects]);

    const tabs: { key: SidebarTab; label: string }[] = React.useMemo(() => [
        { key: 'pending', label: '待处理' },
        { key: 'active', label: t('session.tabs.active') },
        { key: 'closure', label: t('session.tabs.closure') },
        { key: 'inactive', label: t('session.tabs.inactive') },
        { key: 'shared', label: t('session.sharing.sharedWithMeSessions') },
        { key: 'sharedByMe', label: t('session.sharing.sharedByMeSessions') },
    ], []);

    const hasInactiveSessions = inactiveData && inactiveData.length > 0;
    const hasClosureSessions = closureData && closureData.length > 0;
    const hasSharedSessions = sharedData && sharedData.length > 0;
    const hasSharedByMeSessions = sharedByMeData && sharedByMeData.length > 0;

    const HeaderComponent = React.useCallback(() => {
        const visibleTabs = tabs.filter(tab => {
            if (tab.key === 'pending') return true;
            if (tab.key === 'active') return true;
            // Closure tab is always visible — it's an affordance, not a
            // notification. Users need to see the bucket exists in order
            // to discover the "mark for closure" right-click action.
            if (tab.key === 'closure') return true;
            if (tab.key === 'inactive') return hasInactiveSessions;
            if (tab.key === 'shared') return hasSharedSessions;
            if (tab.key === 'sharedByMe') return hasSharedByMeSessions;
            return true;
        });
        const showFilterRow = visibleTabs.length > 1;
        return (
            <>
                <UpdateBanner />
                {showFilterRow && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[styles.filterRow, { flex: 1 }]}>
                            {visibleTabs.map((tab) => (
                                <Pressable
                                    key={tab.key}
                                    style={[
                                        styles.filterChip,
                                        { backgroundColor: activeTab === tab.key ? theme.colors.button.primary.background : theme.colors.surface },
                                    ]}
                                    onPress={() => setActiveTab(tab.key)}
                                >
                                    <Text style={[
                                        styles.filterChipText,
                                        { color: activeTab === tab.key ? theme.colors.button.primary.tint : theme.colors.text },
                                    ]}>
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                )}
                {activeTab === 'pending' && (
                    <View style={styles.pendingSearchSection}>
                        <View style={styles.pendingSearchBox}>
                            <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
                            <TextInput
                                style={styles.pendingSearchInput}
                                value={pendingIssueSearchText}
                                onChangeText={setPendingIssueSearchText}
                                placeholder="搜索 #1212 / 标题 / 仓库"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCorrect={false}
                                autoCapitalize="none"
                                returnKeyType="search"
                            />
                            {pendingIssueSearchText.trim().length > 0 && (
                                <Pressable
                                    onPress={() => setPendingIssueSearchText('')}
                                    hitSlop={8}
                                >
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                            )}
                        </View>
                        <Pressable
                            onPress={handleConfigurePending}
                            style={styles.pendingProjectFilterButton}
                        >
                            <Ionicons name="albums-outline" size={17} color={theme.colors.textSecondary} />
                            <Text style={styles.pendingProjectFilterText} numberOfLines={1}>
                                {projectFilterLabel}
                            </Text>
                            <Ionicons name="options-outline" size={17} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                )}
            </>
        );
    }, [activeTab, theme, hasInactiveSessions, hasClosureSessions, hasSharedSessions, hasSharedByMeSessions, tabs, handleConfigurePending, pendingIssueSearchText, projectFilterLabel]);

    const EmptyComponent = React.useCallback(() => (
        <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12, opacity: 0.5 }} />
            <Text style={styles.emptyText}>
                {t('components.emptySessions.noActiveSessions')}
            </Text>
        </View>
    ), [theme]);

    const PendingEmptyComponent = React.useCallback(() => (
        <View style={styles.emptyContainer}>
            <Ionicons name="logo-github" size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12, opacity: 0.5 }} />
            <Text style={styles.emptyText}>
                {pendingIssuesLoading ? '正在读取 GitHub Issues…' : pendingIssuesError || ((pendingIssueFilterKeywords.length > 0 || pendingIssueProjectFilters.length > 0 || pendingIssueSearchKeyword) ? '没有匹配条件的 GitHub Issues' : '没有待处理的 GitHub Issues')}
            </Text>
        </View>
    ), [theme, pendingIssuesLoading, pendingIssuesError, pendingIssueFilterKeywords.length, pendingIssueProjectFilters.length, pendingIssueSearchKeyword]);

    if (activeTab === 'pending') {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer}>
                    <FlatList
                        data={filteredPendingIssues}
                        renderItem={renderPendingIssue}
                        keyExtractor={(item) => `github-issue-${item.repository}-${item.number}`}
                        contentContainerStyle={{ paddingBottom: safeArea.bottom + 128, maxWidth: layout.maxWidth }}
                        ListHeaderComponent={HeaderComponent}
                        ListEmptyComponent={PendingEmptyComponent}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing || pendingIssuesLoading}
                                onRefresh={handleRefresh}
                                tintColor={theme.colors.textSecondary}
                            />
                        }
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={dataWithSelected}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ paddingBottom: safeArea.bottom + 128, maxWidth: layout.maxWidth }}
                    ListHeaderComponent={HeaderComponent}
                    ListEmptyComponent={EmptyComponent}
                    removeClippedSubviews={true}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.textSecondary}
                        />
                    }
                />
            </View>
        </View>
    );
}

const GitHubIssueItem = React.memo(({ issue, onPress }: {
    issue: GitHubIssue;
    onPress: (issue: GitHubIssue) => void;
}) => {
    const styles = stylesheet;
    const updatedAt = React.useMemo(() => {
        const date = new Date(issue.updatedAt);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    }, [issue.updatedAt]);
    const statusText = issue.projectStatuses.length > 0 ? issue.projectStatuses.join(', ') : null;
    return (
        <Pressable
            style={({ pressed }) => [
                styles.issueItem,
                pressed && { opacity: 0.78 },
            ]}
            onPress={() => onPress(issue)}
        >
            <Ionicons name="logo-github" size={24} color={styles.issueRepo.color} />
            <View style={styles.issueContent}>
                <Text style={styles.issueRepo} numberOfLines={1}>
                    {issue.repository} · #{issue.number}
                </Text>
                <Text style={styles.issueTitle} numberOfLines={2}>
                    {issue.title}
                </Text>
                <Text style={styles.issueMeta} numberOfLines={1}>
                    {statusText ? `状态 ${statusText}` : (updatedAt ? `更新于 ${updatedAt}` : 'GitHub Issue')}{issue.labels.length ? ` · ${issue.labels.slice(0, 3).join(', ')}` : ''}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={styles.issueRepo.color} />
        </Pressable>
    );
});

const GitHubIssueDetailModal = React.memo(({ issue, onStart, onClose }: {
    issue: GitHubIssue;
    onStart: () => void;
    onClose: () => void;
}) => {
    const styles = stylesheet;
    const updatedAt = React.useMemo(() => {
        const date = new Date(issue.updatedAt);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    }, [issue.updatedAt]);
    const body = issue.body?.trim() || '这个 Issue 没有正文。';
    const statusText = issue.projectStatuses.length > 0 ? issue.projectStatuses.join(', ') : 'No Status';
    const projectText = issue.projectTitles.length > 0 ? issue.projectTitles.join(', ') : '未关联 Project';
    return (
        <View style={styles.issueDetailModal}>
            <View style={styles.issueDetailHeader}>
                <Text style={styles.issueDetailRepo} selectable>
                    {issue.repository} · #{issue.number} · {projectText} · 状态 {statusText}
                </Text>
                <Text style={styles.issueDetailTitle} selectable>
                    {issue.title}
                </Text>
                {!!updatedAt && (
                    <Text style={styles.issueDetailRepo} selectable>
                        更新于 {updatedAt}{issue.labels.length ? ` · ${issue.labels.join(', ')}` : ''}
                    </Text>
                )}
            </View>
            <ScrollView style={styles.issueDetailBody}>
                <Text style={styles.issueDetailBodyText} selectable>
                    {body}
                </Text>
            </ScrollView>
            <View style={styles.issueDetailActions}>
                <Pressable style={styles.issueDetailAction} onPress={onClose}>
                    <Text style={styles.issueDetailActionText}>关闭</Text>
                </Pressable>
                <View style={styles.issueDetailActionSeparator} />
                <Pressable style={styles.issueDetailAction} onPress={() => { void Linking.openURL(issue.htmlUrl); }}>
                    <Text style={styles.issueDetailActionText}>打开 GitHub</Text>
                </Pressable>
                <View style={styles.issueDetailActionSeparator} />
                <Pressable style={styles.issueDetailAction} onPress={() => { onClose(); onStart(); }}>
                    <Text style={styles.issueDetailActionText}>开始任务</Text>
                </Pressable>
            </View>
        </View>
    );
});

// Sub-component that handles session message logic
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const compactSessionView = useSetting('compactSessionView');
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    const itemContent = (
        <Pressable
            style={[
                compactSessionView ? styles.sessionItemCompact : styles.sessionItem,
                selected && styles.sessionItemSelected,
                isSingle ? styles.sessionItemSingle :
                    isFirst ? styles.sessionItemFirst :
                        isLast ? styles.sessionItemLast : {}
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
            {!compactSessionView && (
                <View style={styles.avatarContainer}>
                    <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
                    {session.draft && (
                        <View style={styles.draftIconContainer}>
                            <Ionicons
                                name="create-outline"
                                size={12}
                                style={styles.draftIconOverlay}
                            />
                        </View>
                    )}
                </View>
            )}
            <View style={[styles.sessionContent, compactSessionView && { marginLeft: 0 }]}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text style={[
                        compactSessionView ? styles.sessionTitleCompact : styles.sessionTitle,
                        sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={compactSessionView ? 2 : 1}> {/* {variant !== 'no-path' ? 1 : 2} - issue is we don't have anything to take this space yet and it looks strange - if summaries were more reliably generated, we can add this. While no summary - add something like "New session" or "Empty session", and extend summary to 2 lines once we have it */}
                        {sessionName}
                    </Text>
                </View>

                {!compactSessionView && (
                    <>
                        {/* Subtitle line */}
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {sessionSubtitle}
                        </Text>

                        {/* Status line with dot */}
                        <View style={styles.statusRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.statusDotContainer}>
                                    <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                                </View>
                                <Text style={[
                                    styles.statusText,
                                    { color: sessionStatus.statusColor }
                                ]}>
                                    {sessionStatus.statusText}
                                </Text>
                            </View>

                            {(runningTaskCount > 0 || session.ownerProfile || session.isShared) && (
                                <View style={styles.statusIndicatorsRight}>
                                    {runningTaskCount > 0 && !compactSessionView && (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="layers-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                                style={{ marginRight: 2 }}
                                            />
                                            <Text style={styles.taskStatusText}>
                                                {runningTaskCount > 99 ? '99+' : runningTaskCount}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Shared status indicator */}
                                    {session.ownerProfile ? (
                                        <Avatar id={session.ownerProfile.id} size={18} imageUrl={session.ownerProfile.avatar ?? undefined} />
                                    ) : session.isShared ? (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="share-social-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                            />
                                        </View>
                                    ) : null}
                                </View>
                            )}
                        </View>
                    </>
                )}
            </View>
        </Pressable>
    );

    const containerStyles = [
        styles.sessionItemContainer,
        isSingle ? styles.sessionItemContainerSingle :
            isFirst ? styles.sessionItemContainerFirst :
                isLast ? styles.sessionItemContainerLast : {}
    ];

    const showDivider = !isLast && !isSingle;
    const dividerStyle = compactSessionView
        ? [styles.sessionDivider, { marginLeft: 16 }]
        : styles.sessionDivider;

    if (!swipeEnabled) {
        return (
            <View style={containerStyles}>
                {itemContent}
                {showDivider && <View style={dividerStyle} />}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleDelete}
            disabled={deletingSession}
        >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.deleteSession')}
            </Text>
        </Pressable>
    );

    return (
        <View style={containerStyles}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!deletingSession}
            >
                {itemContent}
            </Swipeable>
            {showDivider && <View style={dividerStyle} />}
        </View>
    );
});
