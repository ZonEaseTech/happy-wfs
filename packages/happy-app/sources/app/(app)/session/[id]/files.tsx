import * as React from 'react';
import { View, ActivityIndicator, Platform, TextInput, Pressable } from 'react-native';
import { t } from '@/text';
import { useRoute } from '@react-navigation/native';
import { useRouter, Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { getGitStatusFiles, GitFileStatus, GitStatusFiles, findNearbyGitRepos, NearbyGitRepo } from '@/sync/gitStatusFiles';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { useSessionGitStatus, useSessionProjectGitStatus, useSession, getSession } from '@/sync/storage';
import { sessionBash } from '@/sync/ops';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { FileIcon } from '@/components/FileIcon';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { shellEscape } from '@/utils/shellEscape';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { RepoSelector } from '@/components/RepoSelector';
import { useRightPanelHeaderSlot } from '@/components/RightPanel';

// ── Tree-view helpers ────────────────────────────────────────────────────
type TreeDirNode = { type: 'dir'; name: string; path: string; children: TreeNode[] };
type TreeFileNode = { type: 'file'; name: string; path: string; file: GitFileStatus };
type TreeNode = TreeDirNode | TreeFileNode;

function buildGitFileTree(files: GitFileStatus[]): TreeNode[] {
    const root: TreeDirNode = { type: 'dir', name: '', path: '', children: [] };
    for (const f of files) {
        // GitFileStatus.filePath = directory portion only; fileName = basename.
        // Joining them gives the relative path we want to split into tree segments.
        // Fall back to fullPath if available, then bare fileName for repo-root files.
        const rel = f.filePath
            ? `${f.filePath}/${f.fileName}`
            : f.fileName;
        const parts = rel.split('/').filter(Boolean);
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const dirName = parts[i];
            const pathSoFar = parts.slice(0, i + 1).join('/');
            let next = cur.children.find(c => c.type === 'dir' && c.name === dirName) as TreeDirNode | undefined;
            if (!next) {
                next = { type: 'dir', name: dirName, path: pathSoFar, children: [] };
                cur.children.push(next);
            }
            cur = next;
        }
        cur.children.push({
            type: 'file',
            name: parts[parts.length - 1] ?? f.fileName,
            path: rel,
            file: f,
        });
    }
    return root.children;
}

/** Collapse single-child directory chains: a/b/c/file.ts → "a/b/c" / file.ts */
function collapseTreeChain(node: TreeNode): TreeNode {
    if (node.type !== 'dir') return node;
    let cur = node;
    while (cur.children.length === 1 && cur.children[0].type === 'dir') {
        const child = cur.children[0] as TreeDirNode;
        cur = {
            type: 'dir',
            name: cur.name ? `${cur.name}/${child.name}` : child.name,
            path: child.path,
            children: child.children,
        };
    }
    return { ...cur, children: cur.children.map(collapseTreeChain) };
}

export default function FilesScreen(props?: { sessionId?: string; embedded?: boolean }) {
    const route = useRoute();
    const router = useRouter();
    const sessionId = props?.sessionId ?? ((route.params as any)?.id as string);
    const embedded = props?.embedded ?? false;

    const [gitStatusFiles, setGitStatusFiles] = React.useState<GitStatusFiles | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;
    const { theme } = useUnistyles();
    const isWeb = Platform.OS === 'web';

    const session = useSession(sessionId);
    const isOnline = session?.presence === "online";
    const commandCwd = session?.metadata?.path || '';

    // Multi-repo workspace support
    const workspaceRepos = getWorkspaceRepos(session?.metadata);
    const [selectedRepoIndex, setSelectedRepoIndex] = React.useState(0);
    const selectedRepo = workspaceRepos[selectedRepoIndex];

    // Ad-hoc repo (chosen from "nearby repos" suggestion when cwd itself isn't a git repo)
    const [adHocRepoPath, setAdHocRepoPath] = React.useState<string | null>(null);
    const [nearbyRepos, setNearbyRepos] = React.useState<NearbyGitRepo[]>([]);

    const effectiveRepoPath = adHocRepoPath || selectedRepo?.path;
    const repoBaseCwd = effectiveRepoPath || commandCwd;

    const [isOperating, setIsOperating] = React.useState(false);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [menuItems, setMenuItems] = React.useState<ActionMenuItem[]>([]);
    // Tree view state. Default is list view; user toggles via header button.
    // Collapsed-dirs set tracks which folder paths are currently collapsed
    // (default empty = all expanded for best overview on small change sets).
    const [treeView, setTreeView] = React.useState(false);
    const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() => new Set());
    const toggleDir = React.useCallback((path: string) => {
        setCollapsedDirs(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    // Track whether initial data has been fully loaded (git status + file list if clean)
    const initialLoadDone = React.useRef(false);

    // Load git status files
    const loadGitStatusFiles = React.useCallback(async (silent: boolean = false) => {
        try {
            // Check if the session is offline
            const currentSession = getSession(sessionId);
            if (currentSession?.presence !== 'online') {
                Modal.alert(
                    t('files.sessionOffline'),
                    t('files.sessionOfflineDescription'),
                    [{ text: t('common.ok'), onPress: () => router.back() }]
                );
                setIsLoading(false);
                return;
            }

            // Only show loading indicator on initial load (when no data exists)
            if (!silent && !gitStatusFiles) {
                setIsLoading(true);
            }
            const result = await getGitStatusFiles(sessionId, effectiveRepoPath);
            setGitStatusFiles(result);
            // For repos with changes, initial load is done after git status
            if (result && (result.totalStaged > 0 || result.totalUnstaged > 0)) {
                initialLoadDone.current = true;
                setIsLoading(false);
            } else if (!result) {
                // Not a git repo (or git command failed) — stop loading so the
                // empty-state UI ("not a git repository" + nearby repos) can render.
                initialLoadDone.current = true;
                setIsLoading(false);
            }
            // For clean repos (result exists but no changes), keep isLoading=true until file list loads (handled in search effect)
        } catch (error) {
            console.error('Failed to load git status files:', error);
            // Only clear data on initial load failure
            if (!gitStatusFiles) {
                setGitStatusFiles(null);
            }
            initialLoadDone.current = true;
            setIsLoading(false);
        }
    }, [sessionId, gitStatusFiles, effectiveRepoPath, router]);

    // Stage a file
    const handleStageFile = React.useCallback(async (file: GitFileStatus) => {
        setIsOperating(true);
        try {
            const escapedPath = shellEscape(file.fullPath);
            await sessionBash(sessionId, {
                command: `git add -- ${escapedPath}`,
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Unstage a file
    const handleUnstageFile = React.useCallback(async (file: GitFileStatus) => {
        setIsOperating(true);
        try {
            const escapedPath = shellEscape(file.fullPath);
            await sessionBash(sessionId, {
                command: `git reset HEAD -- ${escapedPath}`,
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Stage all files
    const handleStageAll = React.useCallback(async () => {
        setIsOperating(true);
        try {
            await sessionBash(sessionId, {
                command: 'git add -A',
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Unstage all files
    const handleUnstageAll = React.useCallback(async () => {
        setIsOperating(true);
        try {
            await sessionBash(sessionId, {
                command: 'git reset HEAD',
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Discard changes for a file
    const handleDiscardFile = React.useCallback(async (file: GitFileStatus) => {
        const confirmed = await Modal.confirm(
            t('status.discardTitle'),
            t('status.discardMessage', { fileName: file.fileName }),
            { destructive: true },
        );
        if (!confirmed) return;

        setIsOperating(true);
        try {
            const escapedPath = shellEscape(file.fullPath);
            if (file.status === 'untracked') {
                await sessionBash(sessionId, {
                    command: `git clean -f -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            } else if (file.isStaged) {
                await sessionBash(sessionId, {
                    command: `git reset HEAD -- ${escapedPath} && git checkout -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            } else {
                await sessionBash(sessionId, {
                    command: `git checkout -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            }
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Switch between repos in multi-repo workspace
    const handleRepoSelect = React.useCallback((index: number) => {
        if (index === selectedRepoIndex) return;
        setSelectedRepoIndex(index);
        setGitStatusFiles(null);
        setSearchResults([]);
        setSearchQuery('');
        initialLoadDone.current = false;
        setIsLoading(true);
    }, [selectedRepoIndex]);

    // Long press menu
    const handleLongPress = React.useCallback((file: GitFileStatus, staged: boolean) => {
        const items: ActionMenuItem[] = [];
        if (staged) {
            items.push({
                label: t('status.unstage'),
                onPress: () => handleUnstageFile(file),
            });
        } else {
            items.push({
                label: t('status.stage'),
                onPress: () => handleStageFile(file),
            });
        }
        items.push({
            label: t('status.discard'),
            onPress: () => handleDiscardFile(file),
            destructive: true,
        });
        setMenuItems(items);
        setMenuVisible(true);
    }, [handleStageFile, handleUnstageFile, handleDiscardFile]);

    // Load on mount and when repo selection changes
    React.useEffect(() => {
        initialLoadDone.current = false;
        loadGitStatusFiles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, selectedRepoIndex, adHocRepoPath]);

    // When the active path turns out NOT to be a git repo:
    // - Standalone: redirect to the unified file browser (which lists everything + can create files)
    // - Embedded (RightPanel): scan one level down for nested git repos and offer them as one-tap switches
    //
    // Use repoBaseCwd (effectiveRepoPath || commandCwd) so the scan still
    // runs in the common case where the user has neither a workspaceRepos
    // entry nor an ad-hoc repo selected — falling back to the session's
    // metadata.path means "scan the dir Claude was started in".
    React.useEffect(() => {
        if (isLoading || gitStatusFiles || !repoBaseCwd || adHocRepoPath) {
            return;
        }
        if (!embedded) {
            router.replace(`/session/${sessionId}/browser`);
            return;
        }
        let cancelled = false;
        findNearbyGitRepos(sessionId, repoBaseCwd).then((repos) => {
            if (!cancelled) setNearbyRepos(repos);
        });
        return () => { cancelled = true; };
    }, [sessionId, repoBaseCwd, isLoading, gitStatusFiles, adHocRepoPath, embedded, router]);

    // Refresh silently when screen is focused (after returning from file view)
    useFocusEffect(
        React.useCallback(() => {
            // Silent refresh - don't show loading indicator if we already have data
            if (gitStatusFiles) {
                loadGitStatusFiles(true);
            }
        }, [gitStatusFiles, loadGitStatusFiles])
    );

    // Handle search and file loading
    React.useEffect(() => {
        const loadFiles = async () => {
            if (!sessionId) return;

            try {
                if (initialLoadDone.current) {
                    setIsSearching(true);
                }
                const results = await searchFiles(sessionId, searchQuery, { limit: 100 });
                setSearchResults(results);
            } catch (error) {
                console.error('Failed to search files:', error);
                setSearchResults([]);
            } finally {
                setIsSearching(false);
                if (!initialLoadDone.current) {
                    initialLoadDone.current = true;
                    setIsLoading(false);
                }
            }
        };

        // Load files when searching or when repo is clean
        const isCleanRepo = gitStatusFiles?.totalStaged === 0 && gitStatusFiles?.totalUnstaged === 0;
        const shouldShowAllFiles = searchQuery || isCleanRepo;

        if (shouldShowAllFiles && gitStatusFiles) {
            loadFiles();
        } else if (!searchQuery) {
            setSearchResults([]);
            setIsSearching(false);
        }
    }, [searchQuery, gitStatusFiles, sessionId]);

    const handleFilePress = React.useCallback((file: GitFileStatus | FileItem, staged?: boolean) => {
        // Navigate to file viewer with the file path (base64 encoded for special characters)
        // encodeURIComponent ensures base64 chars (+, /, =) are URL-safe on web
        // For multi-repo: git status returns paths relative to the repo, but file viewer needs
        // absolute paths for sessionReadFile. Prepend repo path to make it absolute.
        const absolutePath = selectedRepo && !file.fullPath.startsWith('/')
            ? `${repoBaseCwd}/${file.fullPath}`
            : file.fullPath;
        const encodedPath = btoa(new TextEncoder().encode(absolutePath).reduce((s, b) => s + String.fromCharCode(b), ''));
        // Staged files always show as diff (read-only). Unstaged / search results jump straight into editor.
        if (staged) {
            router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}&staged=1`);
        } else {
            router.push(`/session/${sessionId}/edit?path=${encodeURIComponent(encodedPath)}`);
        }
    }, [router, sessionId, selectedRepo, repoBaseCwd]);

    const renderFileIcon = (file: GitFileStatus) => {
        return <FileIcon fileName={file.fileName} size={32} />;
    };

    const renderStatusIcon = (file: GitFileStatus) => {
        let statusColor: string;
        let statusIcon: string;

        switch (file.status) {
            case 'modified':
                statusColor = "#FF9500";
                statusIcon = "diff-modified";
                break;
            case 'added':
                statusColor = "#34C759";
                statusIcon = "diff-added";
                break;
            case 'deleted':
                statusColor = "#FF3B30";
                statusIcon = "diff-removed";
                break;
            case 'renamed':
                statusColor = "#007AFF";
                statusIcon = "arrow-right";
                break;
            case 'untracked':
                statusColor = theme.dark ? "#b0b0b0" : "#8E8E93";
                statusIcon = "file";
                break;
            default:
                return null;
        }

        return <Octicons name={statusIcon as any} size={16} color={statusColor} />;
    };

    const renderRightElement = (file: GitFileStatus, staged: boolean) => {
        const hasAdded = file.linesAdded > 0;
        const hasRemoved = file.linesRemoved > 0;
        const hasChanges = hasAdded || hasRemoved;

        const lineChangesEl = hasChanges ? (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                {hasAdded && <Text style={{ color: '#34C759' }}>+{file.linesAdded}</Text>}
                {hasAdded && hasRemoved && ' '}
                {hasRemoved && <Text style={{ color: '#FF3B30' }}>-{file.linesRemoved}</Text>}
            </Text>
        ) : null;

        if (!isWeb) {
            return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {lineChangesEl}
                    {renderStatusIcon(file)}
                </View>
            );
        }
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {lineChangesEl}
                {renderStatusIcon(file)}
                <Pressable
                    onPress={() => handleLongPress(file, staged)}
                    hitSlop={8}
                    style={{ padding: 4 }}
                >
                    <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
        );
    };

    const renderFileSubtitle = (file: GitFileStatus) => {
        return file.filePath || t('files.projectRoot');
    };

    /** Recursive tree renderer for the staged / unstaged sections.
     *  - Dirs render as a Pressable row (folder icon + name) that toggles
     *    collapse; collapsed dirs show their children only after expanding.
     *  - Files reuse the same Item shape as list mode (icon, subtitle, +/-,
     *    longPress, chevron) but with depth-based left padding. */
    const renderTreeNodes = (nodes: TreeNode[], depth: number, isStaged: boolean): React.ReactElement[] => {
        const out: React.ReactElement[] = [];
        for (const node of nodes) {
            if (node.type === 'dir') {
                const collapsed = collapsedDirs.has(node.path);
                out.push(
                    <Pressable
                        key={`dir-${isStaged ? 'staged' : 'unstaged'}-${node.path}`}
                        onPress={() => toggleDir(node.path)}
                        style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingLeft: 16 + depth * 16,
                            paddingRight: 16,
                            paddingVertical: 8,
                            backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                            borderBottomColor: theme.colors.divider,
                        })}
                    >
                        <Ionicons
                            name={collapsed ? 'chevron-forward' : 'chevron-down'}
                            size={14}
                            color={theme.colors.textSecondary}
                            style={{ marginRight: 6 }}
                        />
                        <Octicons name="file-directory" size={20} color="#007AFF" style={{ marginRight: 8 }} />
                        <Text style={{ flex: 1, fontSize: 14, color: theme.colors.text, ...Typography.default('semiBold') }} numberOfLines={1}>
                            {node.name}
                        </Text>
                    </Pressable>,
                );
                if (!collapsed) {
                    out.push(...renderTreeNodes(node.children, depth + 1, isStaged));
                }
            } else {
                out.push(
                    <Item
                        key={`file-${isStaged ? 'staged' : 'unstaged'}-${node.file.fullPath}`}
                        title={node.name}
                        icon={renderFileIcon(node.file)}
                        rightElement={renderRightElement(node.file, isStaged)}
                        onPress={() => handleFilePress(node.file, isStaged)}
                        onLongPress={() => handleLongPress(node.file, isStaged)}
                        showChevron={true}
                        showDivider
                        pressableStyle={{ paddingLeft: 16 + depth * 16 }}
                    />,
                );
            }
        }
        return out;
    };

    const renderFileIconForSearch = (file: FileItem) => {
        if (file.fileType === 'folder') {
            return <Octicons name="file-directory" size={29} color="#007AFF" />;
        }

        return <FileIcon fileName={file.fileName} size={29} />;
    };

    // Project a compact search input into the RightPanel header (embedded mode).
    // Memoized on searchQuery so the slot doesn't churn every render.
    const headerSearchSlot = React.useMemo(() => {
        if (!embedded) return null;
        return (
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.input.background,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 4,
                width: '100%',
            }}>
                <Octicons name="search" size={13} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('files.searchPlaceholder')}
                    style={{
                        flex: 1,
                        fontSize: 13,
                        height: 22,
                        color: theme.colors.text,
                        ...Typography.default(),
                    }}
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                    <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                        <Ionicons name="close-circle" size={14} color={theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>
        );
    }, [embedded, searchQuery, theme]);
    useRightPanelHeaderSlot(headerSearchSlot);

    if (!isOnline) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }]}>
                <Ionicons name="cloud-offline-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 16,
                    ...Typography.default()
                }}>
                    {t('files.sessionOffline')}
                </Text>
                <Text style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 8,
                    marginBottom: 56,
                    ...Typography.default()
                }}>
                    {t('files.sessionOfflineDescription')}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {!embedded && (
                <Stack.Screen
                    options={{
                        headerRight: () => (
                            <Pressable
                                onPress={() => router.push(`/session/${sessionId}/commits`)}
                                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                            >
                                <Octicons name="git-commit" size={20} color={theme.colors.header.tint} />
                            </Pressable>
                        ),
                    }}
                />
            )}

            {/* Embedded mode: when the user picked a nearby repo from the
                empty-state list there's no header back button — give them an
                explicit "← back to repo picker" so they can switch repos. */}
            {embedded && adHocRepoPath && (
                <Pressable
                    onPress={() => setAdHocRepoPath(null)}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                        borderBottomColor: theme.colors.divider,
                        opacity: pressed ? 0.6 : 1,
                    })}
                >
                    <Ionicons name="chevron-back" size={16} color={theme.colors.textSecondary} />
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {adHocRepoPath.split('/').pop() || adHocRepoPath}
                    </Text>
                </Pressable>
            )}

            {/* Repo Selector for multi-repo workspaces */}
            {workspaceRepos.length > 1 && (
                <View style={{
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                }}>
                    <RepoSelector
                        repos={workspaceRepos}
                        selectedIndex={selectedRepoIndex}
                        onSelect={handleRepoSelect}
                    />
                </View>
            )}

            {/* Search Input — inline only when NOT embedded.
                Embedded mode projects the search into the RightPanel header
                (see headerSearchSlot above) so it sits at the very top. */}
            {!embedded && (
                <View style={{
                    padding: 16,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8
                    }}>
                        <Octicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder={t('files.searchPlaceholder')}
                            style={{
                                flex: 1,
                                fontSize: 16,
                                height: 24,
                                color: theme.colors.text,
                                ...Typography.default()
                            }}
                            placeholderTextColor={theme.colors.input.placeholder}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </View>
            )}

            {/* Header with branch info */}
            {!isLoading && gitStatusFiles && (
                <View style={{
                    padding: 16,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginBottom: 8
                    }}>
                        <Octicons name="git-branch" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={{
                            fontSize: 16,
                            fontWeight: '600',
                            color: theme.colors.text,
                            ...Typography.default()
                        }}>
                            {gitStatusFiles.branch || t('files.detachedHead')}
                        </Text>
                    </View>
                    <Text style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        ...Typography.default()
                    }}>
                        {t('files.summary', { staged: gitStatusFiles.totalStaged, unstaged: gitStatusFiles.totalUnstaged })}
                    </Text>
                </View>
            )}

            {/* Git Status List */}
            <ItemList style={{ flex: 1 }}>
                {isLoading ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingTop: 40
                    }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !gitStatusFiles ? (
                    <View style={{
                        flex: 1,
                        alignItems: 'center',
                        paddingTop: 40,
                        paddingHorizontal: 20
                    }}>
                        <Octicons name="git-branch" size={48} color={theme.colors.textSecondary} />
                        <Text style={{
                            fontSize: 16,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 16,
                            ...Typography.default()
                        }}>
                            {t('files.notRepo')}
                        </Text>
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 8,
                            ...Typography.default()
                        }}>
                            {t('files.notUnderGit')}
                        </Text>
                        {nearbyRepos.length > 0 && (
                            <View style={{ marginTop: 32, alignSelf: 'stretch' }}>
                                <Text style={{
                                    fontSize: 13,
                                    color: theme.colors.textSecondary,
                                    marginBottom: 8,
                                    ...Typography.default()
                                }}>
                                    {t('files.foundNearbyRepos')}
                                </Text>
                                {nearbyRepos.map((r) => (
                                    <Pressable
                                        key={r.path}
                                        onPress={() => setAdHocRepoPath(r.path)}
                                        style={({ pressed }) => ({
                                            opacity: pressed ? 0.6 : 1,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            paddingVertical: 10,
                                        })}
                                    >
                                        <Octicons name="repo" size={18} color={theme.colors.textSecondary} />
                                        <View style={{ marginLeft: 10, flex: 1 }}>
                                            <Text style={{
                                                fontSize: 15,
                                                ...Typography.default()
                                            }}>
                                                {r.name}
                                            </Text>
                                            <Text style={{
                                                fontSize: 12,
                                                color: theme.colors.textSecondary,
                                                marginTop: 2,
                                                ...Typography.default()
                                            }}>
                                                {r.path}
                                            </Text>
                                        </View>
                                        <Octicons name="chevron-right" size={16} color={theme.colors.textSecondary} />
                                    </Pressable>
                                ))}
                            </View>
                        )}
                    </View>
                ) : searchQuery || (gitStatusFiles.totalStaged === 0 && gitStatusFiles.totalUnstaged === 0) ? (
                    // Show search results or all files when clean repo
                    // Only show searching indicator on first load (no existing results)
                    isSearching && searchResults.length === 0 ? (
                        <View style={{
                            flex: 1,
                            justifyContent: 'center',
                            alignItems: 'center',
                            paddingTop: 40
                        }}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            <Text style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                textAlign: 'center',
                                marginTop: 16,
                                ...Typography.default()
                            }}>
                                {t('files.searching')}
                            </Text>
                        </View>
                    ) : !isSearching && searchResults.length === 0 ? (
                        <View style={{
                            flex: 1,
                            justifyContent: 'center',
                            alignItems: 'center',
                            paddingTop: 40,
                            paddingHorizontal: 20
                        }}>
                            <Octicons name={searchQuery ? "search" : "file-directory"} size={48} color={theme.colors.textSecondary} />
                            <Text style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                textAlign: 'center',
                                marginTop: 16,
                                ...Typography.default()
                            }}>
                                {searchQuery ? t('files.noFilesFound') : t('files.noFilesInProject')}
                            </Text>
                            {searchQuery && (
                                <Text style={{
                                    fontSize: 14,
                                    color: theme.colors.textSecondary,
                                    textAlign: 'center',
                                    marginTop: 8,
                                    ...Typography.default()
                                }}>
                                    {t('files.tryDifferentTerm')}
                                </Text>
                            )}
                        </View>
                    ) : (
                        // Show search results or all files
                        <>
                            {searchQuery && (
                                <View style={{
                                    backgroundColor: theme.colors.surfaceHigh,
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                    borderBottomColor: theme.colors.divider
                                }}>
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: theme.colors.textLink,
                                        ...Typography.default()
                                    }}>
                                        {t('files.searchResults', { count: searchResults.length })}
                                    </Text>
                                </View>
                            )}
                            {searchResults.map((file, index) => (
                                <Item
                                    key={`file-${file.fullPath}-${index}`}
                                    title={file.fileName}
                                    subtitle={file.filePath || t('files.projectRoot')}
                                    icon={renderFileIconForSearch(file)}
                                    onPress={() => handleFilePress(file)}
                                    showDivider={index < searchResults.length - 1}
                                />
                            ))}
                        </>
                    )
                ) : (
                    <>
                        {/* View-mode toggle bar (list / tree). Single global toggle
                            that flips both staged + unstaged sections at once. */}
                        {(gitStatusFiles.stagedFiles.length > 0 || gitStatusFiles.unstagedFiles.length > 0) && (
                            <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                borderBottomColor: theme.colors.divider,
                                backgroundColor: theme.colors.surface,
                            }}>
                                <Pressable
                                    onPress={() => setTreeView(v => !v)}
                                    hitSlop={8}
                                    style={({ pressed }) => ({
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 4,
                                        paddingHorizontal: 8,
                                        paddingVertical: 4,
                                        borderRadius: 6,
                                        opacity: pressed ? 0.6 : 1,
                                    })}
                                >
                                    <Ionicons
                                        name={treeView ? 'list-outline' : 'git-network-outline'}
                                        size={16}
                                        color={theme.colors.textLink}
                                    />
                                    <Text style={{ fontSize: 12, color: theme.colors.textLink, ...Typography.default() }}>
                                        {treeView ? t('files.viewList') : t('files.viewTree')}
                                    </Text>
                                </Pressable>
                            </View>
                        )}
                        {/* Staged Changes Section */}
                        {gitStatusFiles.stagedFiles.length > 0 && (
                            <>
                                <Pressable
                                    onPress={handleUnstageAll}
                                    disabled={isOperating}
                                    style={{
                                        backgroundColor: theme.colors.surfaceHigh,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                        borderBottomColor: theme.colors.divider,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: theme.colors.success,
                                        ...Typography.default()
                                    }}>
                                        {t('files.stagedChanges', { count: gitStatusFiles.stagedFiles.length })}
                                    </Text>
                                    <Text style={{
                                        fontSize: 13,
                                        color: theme.colors.header.tint,
                                        ...Typography.default(),
                                    }}>
                                        {t('status.unstageAll')}
                                    </Text>
                                </Pressable>
                                {treeView
                                    ? renderTreeNodes(buildGitFileTree(gitStatusFiles.stagedFiles).map(collapseTreeChain), 0, true)
                                    : gitStatusFiles.stagedFiles.map((file, index) => (
                                        <Item
                                            key={`staged-${file.fullPath}-${index}`}
                                            title={file.fileName}
                                            subtitle={renderFileSubtitle(file)}
                                            icon={renderFileIcon(file)}
                                            rightElement={renderRightElement(file, true)}
                                            onPress={() => handleFilePress(file, true)}
                                            onLongPress={() => handleLongPress(file, true)}
                                            showChevron={true}
                                            showDivider={index < gitStatusFiles.stagedFiles.length - 1 || gitStatusFiles.unstagedFiles.length > 0}
                                        />
                                    ))
                                }
                            </>
                        )}

                        {/* Unstaged Changes Section */}
                        {gitStatusFiles.unstagedFiles.length > 0 && (
                            <>
                                <Pressable
                                    onPress={handleStageAll}
                                    disabled={isOperating}
                                    style={{
                                        backgroundColor: theme.colors.surfaceHigh,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                        borderBottomColor: theme.colors.divider,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: theme.colors.warning,
                                        ...Typography.default()
                                    }}>
                                        {t('files.unstagedChanges', { count: gitStatusFiles.unstagedFiles.length })}
                                    </Text>
                                    <Text style={{
                                        fontSize: 13,
                                        color: theme.colors.header.tint,
                                        ...Typography.default(),
                                    }}>
                                        {t('status.stageAll')}
                                    </Text>
                                </Pressable>
                                {treeView
                                    ? renderTreeNodes(buildGitFileTree(gitStatusFiles.unstagedFiles).map(collapseTreeChain), 0, false)
                                    : gitStatusFiles.unstagedFiles.map((file, index) => (
                                        <Item
                                            key={`unstaged-${file.fullPath}-${index}`}
                                            title={file.fileName}
                                            subtitle={renderFileSubtitle(file)}
                                            icon={renderFileIcon(file)}
                                            rightElement={renderRightElement(file, false)}
                                            onPress={() => handleFilePress(file)}
                                            onLongPress={() => handleLongPress(file, false)}
                                            showChevron={true}
                                            showDivider={index < gitStatusFiles.unstagedFiles.length - 1}
                                        />
                                    ))
                                }
                            </>
                        )}
                    </>
                )}
            </ItemList>
            <ActionMenuModal visible={menuVisible} items={menuItems} onClose={() => setMenuVisible(false)} />
        </View>
    );
}

const styles = StyleSheet.create((_theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    }
}));
