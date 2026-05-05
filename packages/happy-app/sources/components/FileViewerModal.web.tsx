import * as React from 'react';
import { View, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { FileIcon } from '@/components/FileIcon';
import { MonacoEditor, inferLanguage } from '@/components/MonacoEditor';
import { sessionReadFile, sessionWriteFile } from '@/sync/ops';
import { useDirectoryTree, type DirectoryTreeNode } from '@/sync/useDirectoryTree';
import { getSession } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';

// `fileViewer.*` keys are added later by impl-integrate; cast through any to
// keep this file independent of the translation files for now.
const tx = t as unknown as (key: string, ...args: any[]) => string;

export interface FileViewerModalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    initialFilePath?: string;
    initialCwd?: string;
}

interface Tab {
    id: string;
    path: string;
    content: string;
    original: string;
    dirty: boolean;
    language: string;
}

type CloseDecision = 'save' | 'discard' | 'cancel';

function decodeBase64Utf8(b64: string): string {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

function encodeUtf8Base64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function basename(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(idx + 1) : path;
}

// Modal.alert is fire-and-forget; this wraps it in a Promise so a 3-button
// "Save / Discard / Cancel" prompt can be awaited inline.
function askSaveDiscardCancel(title: string, message: string): Promise<CloseDecision> {
    return new Promise((resolve) => {
        let decided = false;
        const decide = (v: CloseDecision) => () => { if (!decided) { decided = true; resolve(v); } };
        Modal.alert(title, message, [
            { text: tx('fileViewer.cancel'), style: 'cancel', onPress: decide('cancel') },
            { text: tx('fileViewer.discard'), style: 'destructive', onPress: decide('discard') },
            { text: tx('fileViewer.save'), onPress: decide('save') },
        ]);
    });
}

export function FileViewerModal({
    visible,
    onClose,
    sessionId,
    initialFilePath,
    initialCwd,
}: FileViewerModalProps) {
    const { theme } = useUnistyles();
    const session = getSession(sessionId);
    const rootPath = initialCwd ?? session?.metadata?.path ?? '';

    const [tabs, setTabs] = React.useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = React.useState<string | null>(null);
    const [loadingPath, setLoadingPath] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    // Cursor position is updated by Monaco — but our upstream MonacoEditor
    // contract does not yet expose `onCursorChange`. Statusbar shows "—" until
    // impl-integrate (or a follow-up) extends the editor wrapper.
    const cursor = { line: 0, column: 0 };

    // Latest tabs ref so async handlers (esc, close) see the current state.
    const tabsRef = React.useRef<Tab[]>(tabs);
    React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);

    const activeTab = React.useMemo(
        () => tabs.find(t => t.id === activeTabId) ?? null,
        [tabs, activeTabId],
    );

    const openFile = React.useCallback(async (path: string) => {
        // Already open? Just switch.
        const existing = tabsRef.current.find(t => t.path === path);
        if (existing) {
            setActiveTabId(existing.id);
            return;
        }
        setLoadingPath(path);
        try {
            const resp = await sessionReadFile(sessionId, path);
            if (!resp.success || !resp.content) {
                Modal.alert(t('common.error'), resp.error || tx('fileViewer.openFailed'));
                return;
            }
            let text: string;
            try {
                text = decodeBase64Utf8(resp.content);
            } catch {
                Modal.alert(t('common.error'), tx('fileViewer.binaryNotSupported'));
                return;
            }
            const newTab: Tab = {
                id: `${path}::${Date.now()}`,
                path,
                content: text,
                original: text,
                dirty: false,
                language: inferLanguage(path),
            };
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTab.id);
        } finally {
            setLoadingPath(null);
        }
    }, [sessionId]);

    // Auto-open initialFilePath when modal becomes visible. When the modal is
    // hidden we also reset the entire tab state so reopening doesn't surface stale
    // tabs (or mismatched dirty flags) from a previous session — `requestClose`
    // already prompted the user about unsaved work before getting here.
    const initialOpenedRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!visible) {
            initialOpenedRef.current = null;
            setTabs([]);
            setActiveTabId(null);
            return;
        }
        if (initialFilePath && initialOpenedRef.current !== initialFilePath) {
            initialOpenedRef.current = initialFilePath;
            void openFile(initialFilePath);
        }
    }, [visible, initialFilePath, openFile]);

    const saveTab = React.useCallback(async (tabId: string): Promise<boolean> => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (!tab) return false;
        setSaving(true);
        try {
            const resp = await sessionWriteFile(sessionId, tab.path, encodeUtf8Base64(tab.content));
            if (!resp.success) {
                Modal.alert(t('common.error'), resp.error || tx('fileViewer.saveFailed'));
                return false;
            }
            setTabs(prev => prev.map(t => t.id === tabId
                ? { ...t, original: t.content, dirty: false }
                : t,
            ));
            return true;
        } finally {
            setSaving(false);
        }
    }, [sessionId]);

    const closeTab = React.useCallback(async (tabId: string) => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (!tab) return;
        if (tab.dirty) {
            const decision = await askSaveDiscardCancel(
                tx('fileViewer.unsavedChangesTitle'),
                tx('fileViewer.unsavedChangesSingle', { name: basename(tab.path) }),
            );
            if (decision === 'cancel') return;
            if (decision === 'save') {
                const ok = await saveTab(tabId);
                if (!ok) return;
            }
        }
        setTabs(prev => {
            const idx = prev.findIndex(t => t.id === tabId);
            const next = prev.filter(t => t.id !== tabId);
            // If we just closed the active tab, jump to a neighbour.
            if (tabId === activeTabId) {
                const fallback = next[idx] ?? next[idx - 1] ?? null;
                setActiveTabId(fallback ? fallback.id : null);
            }
            return next;
        });
    }, [activeTabId, saveTab]);

    const requestClose = React.useCallback(async () => {
        const dirtyTabs = tabsRef.current.filter(t => t.dirty);
        if (dirtyTabs.length === 0) {
            onClose();
            return;
        }
        const decision = await askSaveDiscardCancel(
            tx('fileViewer.unsavedChangesTitle'),
            tx('fileViewer.unsavedChangesMulti', { count: dirtyTabs.length }),
        );
        if (decision === 'cancel') return;
        if (decision === 'save') {
            for (const tab of dirtyTabs) {
                const ok = await saveTab(tab.id);
                if (!ok) return;
            }
        }
        onClose();
    }, [onClose, saveTab]);

    // Esc closes the modal — but we route through requestClose so dirty tabs
    // still get the save/discard prompt.
    React.useEffect(() => {
        if (!visible) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                void requestClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [visible, requestClose]);

    const handleEditorChange = React.useCallback((v: string) => {
        if (!activeTabId) return;
        setTabs(prev => prev.map(t => t.id === activeTabId
            ? { ...t, content: v, dirty: v !== t.original }
            : t,
        ));
    }, [activeTabId]);

    const tree = useDirectoryTree(sessionId, rootPath);

    if (!visible) return null;

    return (
        <View
            // @ts-ignore — RN web accepts CSS `position: fixed`. fixed (not absolute)
            // is critical: when FilesScreen runs in embedded mode inside the RightPanel,
            // the panel becomes the nearest positioned ancestor and `absolute` would
            // clip the modal to the panel's bounds. `fixed` anchors to the viewport.
            // zIndex 99999 escapes the Sidebar / drawer / Toast (9999) — this is meant
            // to be the topmost overlay in the app while open.
            style={{
                position: 'fixed' as any,
                top: 0, left: 0, right: 0, bottom: 0,
                zIndex: 99999,
                justifyContent: 'center',
                alignItems: 'center',
            }}
            // @ts-ignore — RN web supports DOM-style mouse handlers.
            onClick={(e: any) => { if (e.target === e.currentTarget) void requestClose(); }}
        >
            <Pressable
                onPress={() => { void requestClose(); }}
                style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                }}
            />
            <View
                style={{
                    width: '95%',
                    height: '95%',
                    maxWidth: 1600,
                    maxHeight: 1100,
                    backgroundColor: theme.colors.surface,
                    borderRadius: 12,
                    overflow: 'hidden',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 12 },
                    shadowOpacity: 0.3,
                    shadowRadius: 30,
                    elevation: 24,
                    flexDirection: 'column',
                }}
            >
                {/* Tabbar + close button (single row at top). */}
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                    minHeight: 38,
                }}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ alignItems: 'center' }}
                    >
                        {tabs.map(tab => {
                            const isActive = tab.id === activeTabId;
                            return (
                                <Pressable
                                    key={tab.id}
                                    onPress={() => setActiveTabId(tab.id)}
                                    style={({ pressed }) => ({
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        paddingHorizontal: 12,
                                        paddingVertical: 8,
                                        borderRightWidth: 1,
                                        borderRightColor: theme.colors.divider,
                                        backgroundColor: isActive ? theme.colors.surface : 'transparent',
                                        opacity: pressed ? 0.7 : 1,
                                        gap: 6,
                                    })}
                                >
                                    <FileIcon fileName={basename(tab.path)} size={14} />
                                    <Text style={{
                                        fontSize: 12,
                                        color: isActive ? theme.colors.text : theme.colors.textSecondary,
                                        ...Typography.default(isActive ? 'semiBold' : undefined),
                                        maxWidth: 200,
                                    }} numberOfLines={1}>
                                        {basename(tab.path)}
                                    </Text>
                                    {tab.dirty && (
                                        <View style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: 3,
                                            backgroundColor: theme.colors.textLink,
                                        }} />
                                    )}
                                    <Pressable
                                        onPress={(e) => { e.stopPropagation?.(); void closeTab(tab.id); }}
                                        hitSlop={8}
                                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.7 })}
                                    >
                                        <Ionicons name="close" size={14} color={theme.colors.textSecondary} />
                                    </Pressable>
                                </Pressable>
                            );
                        })}
                        {loadingPath && !tabs.find(t => t.path === loadingPath) && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6 }}>
                                <ActivityIndicator size="small" />
                                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                                    {basename(loadingPath)}
                                </Text>
                            </View>
                        )}
                    </ScrollView>
                    <Pressable
                        onPress={() => { void requestClose(); }}
                        hitSlop={10}
                        style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            opacity: pressed ? 0.5 : 1,
                        })}
                        accessibilityLabel={tx('fileViewer.close')}
                    >
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

                {/* Body: left tree + right editor. */}
                <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
                    <View style={{
                        width: 260,
                        borderRightWidth: 1,
                        borderRightColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                    }}>
                        <DirectoryTreePanel
                            tree={tree}
                            onSelectFile={(p) => { void openFile(p); }}
                        />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        {activeTab ? (
                            <MonacoEditor
                                value={activeTab.content}
                                onChange={handleEditorChange}
                                path={activeTab.path}
                                theme="vs-dark"
                                height="100%"
                            />
                        ) : (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ fontSize: 14, color: theme.colors.textSecondary, ...Typography.default() }}>
                                    {tx('fileViewer.noFileOpen')}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Statusbar. */}
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                    gap: 16,
                }}>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {cursor.line > 0
                            ? tx('fileViewer.cursorPosition', { line: cursor.line, column: cursor.column })
                            : tx('fileViewer.cursorPositionUnknown')}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {tx('fileViewer.encodingUtf8')}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {tx('fileViewer.languageLabel', { language: activeTab?.language ?? '—' })}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                        onPress={() => { if (activeTab) void saveTab(activeTab.id); }}
                        disabled={!activeTab || !activeTab.dirty || saving}
                        hitSlop={6}
                        style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            borderRadius: 6,
                            backgroundColor: activeTab?.dirty
                                ? theme.colors.button.primary.background
                                : 'transparent',
                            opacity: pressed ? 0.7 : 1,
                        })}
                    >
                        {saving
                            ? <ActivityIndicator size="small" />
                            : <Ionicons
                                name="save-outline"
                                size={14}
                                color={activeTab?.dirty ? theme.colors.button.primary.tint : theme.colors.textSecondary}
                            />}
                        <Text style={{
                            fontSize: 12,
                            color: activeTab?.dirty ? theme.colors.button.primary.tint : theme.colors.textSecondary,
                            ...Typography.default('semiBold'),
                        }}>
                            {tx('fileViewer.save')}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

interface DirectoryTreePanelProps {
    tree: ReturnType<typeof useDirectoryTree>;
    onSelectFile: (path: string) => void;
}

function DirectoryTreePanel({ tree, onSelectFile }: DirectoryTreePanelProps) {
    const { theme } = useUnistyles();
    const { tree: nodes, expand, collapse, isLoading, errors } = tree;

    const renderNode = (node: DirectoryTreeNode, depth: number): React.ReactNode => {
        const { entry, expanded, children } = node;
        const isDir = entry.type === 'dir';
        const loading = isLoading.get(entry.path) ?? false;
        const error = errors.get(entry.path);

        return (
            <React.Fragment key={entry.path}>
                <Pressable
                    onPress={() => {
                        if (isDir) {
                            if (expanded) collapse(entry.path);
                            else void expand(entry.path);
                        } else {
                            onSelectFile(entry.path);
                        }
                    }}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 4,
                        paddingLeft: 8 + depth * 14,
                        paddingRight: 8,
                        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                        gap: 4,
                    })}
                >
                    {isDir
                        ? <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={12} color={theme.colors.textSecondary} />
                        : <View style={{ width: 12 }} />}
                    {isDir
                        ? <Ionicons name="folder" size={14} color="#007AFF" />
                        : <FileIcon fileName={entry.name} size={14} />}
                    <Text
                        numberOfLines={1}
                        style={{ marginLeft: 4, fontSize: 12, color: theme.colors.text, ...Typography.default(), flex: 1 }}
                    >
                        {entry.name}
                    </Text>
                    {loading && <ActivityIndicator size="small" />}
                </Pressable>
                {error && (
                    <Text style={{
                        fontSize: 11,
                        color: theme.colors.textDestructive ?? '#dc2626',
                        paddingLeft: 8 + (depth + 1) * 14,
                        ...Typography.default(),
                    }}>
                        {error}
                    </Text>
                )}
                {expanded && children?.map(c => renderNode(c, depth + 1))}
            </React.Fragment>
        );
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 6 }}>
            {nodes.map(n => renderNode(n, 0))}
        </ScrollView>
    );
}
