import * as React from 'react';
import { View, ActivityIndicator, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Typography } from '@/constants/Typography';
import { sessionBash } from '@/sync/ops';
import { getSession } from '@/sync/storage';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { FileIcon } from '@/components/FileIcon';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import * as Clipboard from 'expo-clipboard';
import { t } from '@/text';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { shellEscape } from '@/utils/shellEscape';
import { DesktopModalShell } from '@/components/DesktopModalShell';
import { FileViewerModal } from '@/components/FileViewerModal';

const SPLIT_BREAKPOINT = 900;
const LEFT_PANEL_WIDTH = 380;

interface CommitDetail {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: Date;
    title: string;
    body: string;
}

interface CommitFile {
    fileName: string;
    filePath: string;
    additions: number;
    deletions: number;
}

type DirNode = {
    type: 'dir';
    name: string;          // can include '/' after single-child collapse
    path: string;          // full path of last segment in this collapsed chain
    children: TreeNode[];
};
type FileNode = {
    type: 'file';
    name: string;
    path: string;
    file: CommitFile;
};
type TreeNode = DirNode | FileNode;

function formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diffSeconds = Math.floor((now - date.getTime()) / 1000);
    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    const diffYears = Math.floor(diffDays / 365);
    return `${diffYears}y ago`;
}

function parseCommitDetail(stdout: string): CommitDetail | null {
    const lines = stdout.trim().split('\n');
    if (lines.length < 6) return null;
    return {
        hash: lines[0] || '',
        shortHash: lines[1] || '',
        author: lines[2] || '',
        email: lines[3] || '',
        date: new Date(parseInt(lines[4] || '0') * 1000),
        title: lines[5] || '',
        body: lines.slice(6).join('\n').trim(),
    };
}

function parseDiffTree(stdout: string): CommitFile[] {
    return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [add, del, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');
        return {
            fileName: filePath.split('/').pop() || filePath,
            filePath,
            additions: add === '-' ? 0 : parseInt(add || '0'),
            deletions: del === '-' ? 0 : parseInt(del || '0'),
        };
    });
}

function buildFileTree(files: CommitFile[]): TreeNode[] {
    const root: DirNode = { type: 'dir', name: '', path: '', children: [] };
    for (const f of files) {
        const parts = f.filePath.split('/');
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const dirName = parts[i];
            const pathSoFar = parts.slice(0, i + 1).join('/');
            let next = cur.children.find(c => c.type === 'dir' && c.name === dirName) as DirNode | undefined;
            if (!next) {
                next = { type: 'dir', name: dirName, path: pathSoFar, children: [] };
                cur.children.push(next);
            }
            cur = next;
        }
        cur.children.push({
            type: 'file',
            name: parts[parts.length - 1],
            path: f.filePath,
            file: f,
        });
    }
    return root.children;
}

function collapseChain(node: TreeNode): TreeNode {
    if (node.type !== 'dir') return node;
    let cur = node;
    while (cur.children.length === 1 && cur.children[0].type === 'dir') {
        const child = cur.children[0] as DirNode;
        cur = {
            type: 'dir',
            name: cur.name ? `${cur.name}/${child.name}` : child.name,
            path: child.path,
            children: child.children,
        };
    }
    return {
        ...cur,
        children: cur.children.map(collapseChain),
    };
}

const DiffLine = React.memo(function DiffLine({ line }: { line: string }) {
    const { theme } = useUnistyles();
    const isAdd = line.startsWith('+') && !line.startsWith('+++');
    const isDel = line.startsWith('-') && !line.startsWith('---');
    const isHunk = line.startsWith('@@');
    const isHeader = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ');
    let bg: string = 'transparent';
    let color: string = theme.colors.diff.contextText;
    let weight: '400' | '600' = '400';
    if (isAdd) { bg = theme.colors.diff.addedBg; color = theme.colors.diff.addedText; }
    else if (isDel) { bg = theme.colors.diff.removedBg; color = theme.colors.diff.removedText; }
    else if (isHunk) { bg = theme.colors.diff.hunkHeaderBg; color = theme.colors.diff.hunkHeaderText; weight = '600'; }
    else if (isHeader) { color = theme.colors.text; weight = '600'; }
    return (
        <View style={{
            backgroundColor: bg,
            paddingHorizontal: 8,
            paddingVertical: 1,
            borderLeftWidth: (isAdd || isDel) ? 3 : 0,
            borderLeftColor: isAdd ? theme.colors.diff.addedBorder : theme.colors.diff.removedBorder,
        }}>
            <Text style={{ ...Typography.mono(), fontSize: 13, lineHeight: 19, color, fontWeight: weight }}>
                {line || ' '}
            </Text>
        </View>
    );
});

const FileDiffPanel = React.memo(function FileDiffPanel(props: {
    sessionId: string;
    repoCwd: string;
    hash: string;
    file: CommitFile;
}) {
    const { theme } = useUnistyles();
    const [diff, setDiff] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setDiff(null);
        const escapedPath = shellEscape(props.file.filePath);
        const escapedHash = shellEscape(props.hash);
        sessionBash(props.sessionId, {
            command: `git diff-tree -p --no-commit-id ${escapedHash} -- ${escapedPath}`,
            cwd: props.repoCwd,
            timeout: 15000,
        }).then(res => {
            if (cancelled) return;
            if (res.success) {
                setDiff(res.stdout || '');
            } else {
                setError(res.error || 'Failed to load diff');
            }
        }).catch(() => {
            if (!cancelled) setError('Failed to load diff');
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [props.sessionId, props.repoCwd, props.hash, props.file.filePath]);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            <View style={{
                paddingHorizontal: 14, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
                flexDirection: 'row', alignItems: 'center', gap: 8,
            }}>
                <FileIcon fileName={props.file.fileName} size={22} />
                <Text numberOfLines={1} style={{ flex: 1, ...Typography.mono(), fontSize: 13, color: theme.colors.text }}>
                    {props.file.filePath}
                </Text>
                {props.file.additions > 0 && (
                    <Text style={{ ...Typography.mono(), fontSize: 13, color: '#34C759' }}>+{props.file.additions}</Text>
                )}
                {props.file.deletions > 0 && (
                    <Text style={{ ...Typography.mono(), fontSize: 13, color: '#FF3B30' }}>-{props.file.deletions}</Text>
                )}
            </View>
            {loading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            ) : error ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, ...Typography.default(), textAlign: 'center' }}>{error}</Text>
                </View>
            ) : diff && diff.trim() ? (
                <ScrollView horizontal style={{ flex: 1 }}>
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8, minWidth: '100%' }}>
                        {diff.split('\n').map((line, idx) => (
                            <DiffLine key={idx} line={line} />
                        ))}
                    </ScrollView>
                </ScrollView>
            ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, ...Typography.default(), textAlign: 'center' }}>
                        Binary file or empty diff
                    </Text>
                </View>
            )}
        </View>
    );
});

const TreeRow = React.memo(function TreeRow(props: {
    node: TreeNode;
    depth: number;
    collapsed: Set<string>;
    onToggle: (path: string) => void;
    onSelect: (file: CommitFile) => void;
    selectedPath: string | null;
}) {
    const { theme } = useUnistyles();
    if (props.node.type === 'dir') {
        const isCollapsed = props.collapsed.has(props.node.path);
        return (
            <View>
                <Pressable
                    onPress={() => props.onToggle(props.node.path)}
                    style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center',
                        paddingLeft: 12 + props.depth * 14,
                        paddingRight: 12, paddingVertical: 6,
                        backgroundColor: pressed ? theme.colors.divider : 'transparent',
                    })}
                >
                    <Ionicons
                        name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                        size={14}
                        color={theme.colors.textSecondary}
                        style={{ marginRight: 4, width: 14 }}
                    />
                    <Ionicons
                        name="folder-outline"
                        size={16}
                        color={theme.colors.textSecondary}
                        style={{ marginRight: 6 }}
                    />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {props.node.name}
                    </Text>
                </Pressable>
                {!isCollapsed && props.node.children.map((c, i) => (
                    <TreeRow
                        key={c.type === 'dir' ? `d:${c.path}:${i}` : `f:${c.path}`}
                        node={c}
                        depth={props.depth + 1}
                        collapsed={props.collapsed}
                        onToggle={props.onToggle}
                        onSelect={props.onSelect}
                        selectedPath={props.selectedPath}
                    />
                ))}
            </View>
        );
    }
    const file = props.node.file;
    const isSelected = props.selectedPath === file.filePath;
    return (
        <Pressable
            onPress={() => props.onSelect(file)}
            style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center',
                paddingLeft: 12 + props.depth * 14,
                paddingRight: 12, paddingVertical: 8,
                backgroundColor: isSelected
                    ? 'rgba(125,125,125,0.18)'
                    : (pressed ? theme.colors.divider : 'transparent'),
            })}
        >
            <FileIcon fileName={file.fileName} size={20} />
            <Text numberOfLines={1} style={{ flex: 1, marginLeft: 8, fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                {file.fileName}
            </Text>
            {file.additions > 0 && (
                <Text style={{ marginLeft: 4, fontSize: 12, color: '#34C759', ...Typography.mono() }}>+{file.additions}</Text>
            )}
            {file.deletions > 0 && (
                <Text style={{ marginLeft: 4, fontSize: 12, color: '#FF3B30', ...Typography.mono() }}>-{file.deletions}</Text>
            )}
        </Pressable>
    );
});

export default function CommitScreen() {
    const route = useRoute();
    const router = useRouter();
    const sessionId = (route.params! as any).id as string;
    const searchParams = useLocalSearchParams();
    const hash = searchParams.hash as string;
    const { theme } = useUnistyles();
    const { width: windowWidth } = useWindowDimensions();
    const isSplit = windowWidth >= SPLIT_BREAKPOINT;

    const session = getSession(sessionId);
    const sessionPath = session?.metadata?.path || '';
    const cwdParam = searchParams.cwd as string | undefined;
    const repoCwd = cwdParam || sessionPath;

    const [commitDetail, setCommitDetail] = React.useState<CommitDetail | null>(null);
    const [files, setFiles] = React.useState<CommitFile[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
    const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() => new Set());
    const isPC = Platform.OS === 'web' && windowWidth >= 768;
    const [showViewer, setShowViewer] = React.useState(false);
    const [viewerPath, setViewerPath] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [infoRes, filesRes] = await Promise.all([
                    sessionBash(sessionId, {
                        command: `git show --format="%H%n%h%n%an%n%ae%n%at%n%s%n%b" --no-patch ${hash}`,
                        cwd: repoCwd,
                        timeout: 10000,
                    }),
                    sessionBash(sessionId, {
                        command: `git diff-tree --no-commit-id -r --numstat ${hash}`,
                        cwd: repoCwd,
                        timeout: 10000,
                    }),
                ]);

                if (cancelled) return;

                if (infoRes.success && infoRes.stdout) {
                    setCommitDetail(parseCommitDetail(infoRes.stdout));
                } else {
                    const isNotGitRepo = !!infoRes.error && /not a git repository/i.test(infoRes.error);
                    setError(isNotGitRepo ? t('commits.notAGitRepo') : (infoRes.error || 'Failed to load commit'));
                }

                if (filesRes.success && filesRes.stdout) {
                    setFiles(parseDiffTree(filesRes.stdout));
                }
            } catch {
                if (!cancelled) setError('Failed to load commit');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [sessionId, repoCwd, hash]);

    // Auto-select first file when split layout shows for the first time
    React.useEffect(() => {
        if (isSplit && files.length > 0 && !selectedFilePath) {
            setSelectedFilePath(files[0].filePath);
        }
    }, [isSplit, files, selectedFilePath]);

    const tree = React.useMemo(
        () => buildFileTree(files).map(collapseChain),
        [files],
    );

    const toggleDir = React.useCallback((p: string) => {
        setCollapsedDirs(prev => {
            const next = new Set(prev);
            if (next.has(p)) next.delete(p);
            else next.add(p);
            return next;
        });
    }, []);

    const handleFileSelect = React.useCallback((file: CommitFile) => {
        if (isSplit) {
            setSelectedFilePath(file.filePath);
            return;
        }
        const fullPath = `${repoCwd}/${file.filePath}`;
        // PC: open the bt-style FileViewerModal. MVP limitation: the modal
        // shows the *current head* of the file, not the historical version
        // at this commit's `ref` — historical browsing still requires the
        // /session/[id]/file route. Tracked as follow-up.
        if (isPC) {
            setViewerPath(fullPath);
            setShowViewer(true);
            return;
        }
        const encodedPath = btoa(
            new TextEncoder().encode(fullPath).reduce((s, b) => s + String.fromCharCode(b), '')
        );
        router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}&ref=${hash}`);
    }, [isSplit, router, sessionId, repoCwd, hash, isPC]);

    const selectedFile = React.useMemo(() => {
        if (!selectedFilePath) return null;
        return files.find(f => f.filePath === selectedFilePath) || null;
    }, [selectedFilePath, files]);

    const [menuVisible, setMenuVisible] = React.useState(false);
    const menuItems: ActionMenuItem[] = React.useMemo(() => {
        if (!commitDetail) return [];
        return [
            {
                label: t('commits.copyHash'),
                onPress: async () => {
                    await Clipboard.setStringAsync(commitDetail.hash);
                    hapticsLight(); showCopiedToast();
                },
            },
            {
                label: t('commits.copyMessage'),
                onPress: async () => {
                    const message = commitDetail.body
                        ? `${commitDetail.title}\n\n${commitDetail.body}`
                        : commitDetail.title;
                    await Clipboard.setStringAsync(message);
                    hapticsLight(); showCopiedToast();
                },
            },
        ];
    }, [commitDetail]);

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    if (isLoading) {
        return (
            <DesktopModalShell title="">
                <View style={[styles.containerCentered, { backgroundColor: theme.colors.surface }]}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            </DesktopModalShell>
        );
    }

    if (error || !commitDetail) {
        return (
            <DesktopModalShell title="">
                <View style={[styles.containerCentered, { backgroundColor: theme.colors.surface, padding: 20 }]}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 16, ...Typography.default() }}>
                        {error || 'Failed to load commit'}
                    </Text>
                </View>
            </DesktopModalShell>
        );
    }

    const headerBlock = (
        <ItemGroup>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                <Text style={{
                    fontSize: 17,
                    fontWeight: '600',
                    color: theme.colors.text,
                    marginBottom: commitDetail.body ? 8 : 4,
                    ...Typography.default('semiBold'),
                }}>
                    {commitDetail.title}
                </Text>
                {commitDetail.body ? (
                    <Text style={{
                        fontSize: 14,
                        color: theme.colors.textSecondary,
                        marginBottom: 8,
                        lineHeight: 20,
                        ...Typography.default(),
                    }}>
                        {commitDetail.body}
                    </Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.mono() }}>
                        {commitDetail.shortHash}
                    </Text>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginHorizontal: 6, ...Typography.default() }}>
                        ·
                    </Text>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {commitDetail.author} · {formatRelativeTime(commitDetail.date)}
                    </Text>
                </View>
            </View>
        </ItemGroup>
    );

    const statsBlock = (
        <ItemGroup>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                    {t('commits.filesChanged', { count: files.length })}
                </Text>
                {totalAdditions > 0 && (
                    <Text style={{ fontSize: 14, color: '#34C759', ...Typography.default() }}>
                        +{totalAdditions}
                    </Text>
                )}
                {totalDeletions > 0 && (
                    <Text style={{ fontSize: 14, color: '#FF3B30', ...Typography.default() }}>
                        -{totalDeletions}
                    </Text>
                )}
            </View>
        </ItemGroup>
    );

    const treeBlock = (
        <ItemGroup>
            <View style={{ paddingVertical: 4 }}>
                {tree.map((node, idx) => (
                    <TreeRow
                        key={node.type === 'dir' ? `d:${node.path}:${idx}` : `f:${node.path}`}
                        node={node}
                        depth={0}
                        collapsed={collapsedDirs}
                        onToggle={toggleDir}
                        onSelect={handleFileSelect}
                        selectedPath={selectedFilePath}
                    />
                ))}
            </View>
        </ItemGroup>
    );

    return (
        <DesktopModalShell title={commitDetail?.title || commitDetail?.shortHash || ''}>
        <View style={[
            { flex: 1, backgroundColor: theme.colors.groupped?.background || theme.colors.surface },
            !isSplit && { maxWidth: layout.maxWidth, alignSelf: 'center' as const, width: '100%' },
        ]}>
            <Stack.Screen
                options={{
                    headerRight: () => (
                        <Pressable
                            onPress={() => setMenuVisible(true)}
                            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                        >
                            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
            />
            <View style={{ flex: 1, flexDirection: isSplit ? 'row' : 'column' }}>
                <View style={[
                    isSplit
                        ? { width: LEFT_PANEL_WIDTH, height: '100%' as any, borderRightWidth: 1, borderRightColor: theme.colors.divider }
                        : { flex: 1 },
                ]}>
                    <ItemList style={{ flex: 1 }}>
                        {headerBlock}
                        {statsBlock}
                        {treeBlock}
                    </ItemList>
                </View>
                {isSplit && (
                    <View style={{ flex: 1 }}>
                        {selectedFile ? (
                            <FileDiffPanel
                                sessionId={sessionId}
                                repoCwd={repoCwd}
                                hash={hash}
                                file={selectedFile}
                            />
                        ) : (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                                <Ionicons name="document-text-outline" size={36} color={theme.colors.textSecondary} />
                                <Text style={{ marginTop: 12, color: theme.colors.textSecondary, ...Typography.default(), textAlign: 'center' }}>
                                    Select a file to view diff
                                </Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
            <FileViewerModal
                visible={showViewer}
                onClose={() => setShowViewer(false)}
                sessionId={sessionId}
                initialFilePath={viewerPath}
                initialCwd={repoCwd}
            />
        </View>
        </DesktopModalShell>
    );
}

const styles = StyleSheet.create((_theme) => ({
    containerCentered: {
        flex: 1,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
    },
}));
