import * as React from 'react';
import { View, Pressable, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { createPortal } from 'react-dom';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { FileIcon } from '@/components/FileIcon';
import { MonacoEditor, inferLanguage } from '@/components/MonacoEditor';
import {
    sessionReadFile,
    sessionWriteFile,
    sessionRename,
    sessionDeleteFile,
    sessionDeleteDirectory,
    sessionCreateFile,
    sessionCreateDirectory,
    sessionListDirectory,
    sessionBash,
    machineReadFile,
    machineWriteFile,
    machineRename,
    machineDeleteFile,
    machineDeleteDirectory,
    machineCreateDirectory,
    machineListDirectory,
    machineBash,
} from '@/sync/ops';
import { useDirectoryTree, type DirectoryTreeNode } from '@/sync/useDirectoryTree';
import { compressAndDownload } from '@/components/fileViewer/archiveOps';
import { ResizableHandle } from '@/components/ResizableHandle';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { getSession } from '@/sync/storage';
import { t } from '@/text';

// Override the app's Modal Manager with native browser dialogs INSIDE this
// file. Reason: the FileViewerModal is rendered via createPortal directly into
// document.body with zIndex: 99999, so any Modal.alert / Modal.prompt that
// renders into the React app root ends up DOM-ordered BEHIND the portal and
// becomes invisible. window.alert/confirm/prompt are painted by the browser
// chrome and always sit on top of anything else, so they're the only reliable
// path here. Local `Modal` shadows the import entirely so existing call sites
// (Modal.alert(...) / Modal.prompt(...)) keep their current shape.
type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
const Modal = {
    alert(title: string, message?: string, buttons?: AlertButton[]): void {
        const body = message ? `${title}\n\n${message}` : title;
        if (!buttons || buttons.length === 0) {
            window.alert(body);
            return;
        }
        if (buttons.length === 1) {
            window.alert(body);
            buttons[0].onPress?.();
            return;
        }
        if (buttons.length === 2) {
            // Map cancel-style to "Cancel" of the confirm: OK = the other action.
            const cancelIdx = buttons.findIndex(b => b.style === 'cancel');
            const cancelBtn = cancelIdx >= 0 ? buttons[cancelIdx] : buttons[0];
            const okBtn = buttons.find((_, i) => i !== buttons.indexOf(cancelBtn)) ?? buttons[1];
            const ok = window.confirm(`${body}\n\n[OK = ${okBtn.text}, Cancel = ${cancelBtn.text}]`);
            (ok ? okBtn : cancelBtn).onPress?.();
            return;
        }
        // 3+ buttons: prompt for a numeric choice.
        const labels = buttons.map((b, i) => `${i + 1}. ${b.text}${b.style === 'cancel' ? ' (default)' : ''}`).join('\n');
        const cancelBtn = buttons.find(b => b.style === 'cancel');
        const cancelIdx = cancelBtn ? buttons.indexOf(cancelBtn) : 0;
        const raw = window.prompt(`${body}\n\n${labels}\n\nEnter number:`, String(cancelIdx + 1));
        if (raw == null) {
            cancelBtn?.onPress?.();
            return;
        }
        const idx = parseInt(raw, 10) - 1;
        const target = buttons[idx];
        target?.onPress?.();
    },
    async prompt(
        title: string,
        message?: string,
        // happy-app's real Modal.prompt takes an options object as 3rd arg
        // ({ defaultValue, confirmText, cancelText }); we accept a plain string
        // too for forward compat.
        opts?: string | { defaultValue?: string; confirmText?: string; cancelText?: string },
    ): Promise<string | null> {
        const defaultValue = typeof opts === 'string' ? opts : opts?.defaultValue ?? '';
        const body = message ? `${title}\n\n${message}` : title;
        return window.prompt(body, defaultValue);
    },
};

// `fileViewer.*` keys are added later by impl-integrate; cast through any to
// keep this file independent of the translation files for now.
const tx = t as unknown as (key: string, ...args: any[]) => string;

export interface FileViewerModalProps {
    visible: boolean;
    onClose: () => void;
    /**
     * Provide either sessionId OR machineId. If both are passed, sessionId
     * wins and the modal operates in session mode. Machine mode reaches
     * paths under HAPPY_DAEMON_ROOT (e.g. ~/.claude/...) without needing
     * an active session.
     */
    sessionId?: string;
    machineId?: string;
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

function decodeBase64Bytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function encodeUtf8Base64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// btoa() requires a binary string. For raw upload bytes (PNG/PDF/etc.) we
// can't go through TextEncoder — we just walk the buffer in 8KB chunks so
// String.fromCharCode doesn't blow the call-stack on big files.
function bytesToBase64(bytes: Uint8Array): string {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return btoa(binary);
}

function basename(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirname(path: string): string {
    const idx = path.lastIndexOf('/');
    if (idx <= 0) return '/';
    return path.slice(0, idx);
}

function joinPath(parent: string, name: string): string {
    if (parent.endsWith('/')) return `${parent}${name}`;
    return `${parent}/${name}`;
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

// Trigger a browser download of the given bytes (web only). Wrapped in a try
// so a failure (e.g. unavailable createObjectURL in some embedded contexts)
// surfaces as a Modal alert rather than a silent no-op.
function downloadBlob(name: string, bytes: Uint8Array): void {
    try {
        // Cast bytes to ArrayBuffer-compatible source for Blob; SharedArrayBuffer not relevant here.
        const blob = new Blob([bytes as BlobPart]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so Safari has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        Modal.alert(t('common.error'), e instanceof Error ? e.message : 'Download failed');
    }
}

interface ContextMenuState {
    x: number;
    y: number;
    entry: { path: string; name: string; type: 'file' | 'dir' };
}

export function FileViewerModal({
    visible,
    onClose,
    sessionId,
    machineId,
    initialFilePath,
    initialCwd,
}: FileViewerModalProps) {
    const { theme } = useUnistyles();
    // sessionId wins if both are provided; machine mode is the fallback.
    const isMachineMode = !sessionId && !!machineId;
    const session = sessionId ? getSession(sessionId) : undefined;
    const baseRoot = initialCwd ?? session?.metadata?.path ?? '';
    const [rootPath, setRootPath] = React.useState<string>(baseRoot);

    // Bind RPCs to the active mode once. Each closure dispatches to the right
    // implementation; the rest of the component stays mode-agnostic.
    const readFile = React.useCallback((p: string) => (
        isMachineMode ? machineReadFile(machineId!, p) : sessionReadFile(sessionId!, p)
    ), [isMachineMode, machineId, sessionId]);
    const writeFile = React.useCallback((p: string, content: string) => (
        isMachineMode ? machineWriteFile(machineId!, p, content) : sessionWriteFile(sessionId!, p, content)
    ), [isMachineMode, machineId, sessionId]);
    const renameFn = React.useCallback((from: string, to: string) => (
        isMachineMode ? machineRename(machineId!, from, to) : sessionRename(sessionId!, from, to)
    ), [isMachineMode, machineId, sessionId]);
    const deleteFile = React.useCallback((p: string) => (
        isMachineMode ? machineDeleteFile(machineId!, p) : sessionDeleteFile(sessionId!, p)
    ), [isMachineMode, machineId, sessionId]);
    const deleteDirectory = React.useCallback((p: string) => (
        isMachineMode ? machineDeleteDirectory(machineId!, p) : sessionDeleteDirectory(sessionId!, p)
    ), [isMachineMode, machineId, sessionId]);
    const createFile = React.useCallback((p: string, content?: string) => (
        // Machine RPC has no explicit createFile; writeFile creates-or-truncates
        // which is the same MVP semantic the session createFile guarantees here.
        isMachineMode
            ? machineWriteFile(machineId!, p, content ?? '')
            : sessionCreateFile(sessionId!, p, content)
    ), [isMachineMode, machineId, sessionId]);
    const createDirectory = React.useCallback((p: string) => (
        isMachineMode ? machineCreateDirectory(machineId!, p) : sessionCreateDirectory(sessionId!, p)
    ), [isMachineMode, machineId, sessionId]);
    const listDirectoryFn = React.useCallback((p: string) => (
        isMachineMode ? machineListDirectory(machineId!, p) : sessionListDirectory(sessionId!, p)
    ), [isMachineMode, machineId, sessionId]);
    const bashFn = React.useCallback((req: Parameters<typeof sessionBash>[1]) => (
        isMachineMode ? machineBash(machineId!, req) : sessionBash(sessionId!, req)
    ), [isMachineMode, machineId, sessionId]);

    const entityId = (sessionId ?? machineId ?? '');

    // When the session/initial cwd changes we want to reset the tree root.
    React.useEffect(() => {
        setRootPath(baseRoot);
    }, [baseRoot]);

    const [tabs, setTabs] = React.useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = React.useState<string | null>(null);
    const [loadingPath, setLoadingPath] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    // Cursor position is updated by Monaco — but our upstream MonacoEditor
    // contract does not yet expose `onCursorChange`. Statusbar shows "—" until
    // impl-integrate (or a follow-up) extends the editor wrapper.
    const cursor = { line: 0, column: 0 };

    // Latest tabs ref so async handlers (esc, close) see the current state.
    // Tree pane width is user-resizable via the ResizableHandle on its right edge.
    // Persist last value to localStorage so reopening the modal keeps the user's choice.
    const [treeWidth, setTreeWidth] = React.useState<number>(() => {
        if (typeof window === 'undefined') return 260;
        const saved = parseInt(window.localStorage?.getItem('fileViewer.treeWidth') ?? '', 10);
        return Number.isFinite(saved) && saved >= 150 && saved <= 600 ? saved : 260;
    });
    const persistTreeWidth = React.useCallback((w: number) => {
        setTreeWidth(w);
        try { window.localStorage?.setItem('fileViewer.treeWidth', String(w)); } catch {}
    }, []);

    // Show hidden files toggle (.git / node_modules / .DS_Store etc).
    // Persisted to localStorage so each user keeps their preference.
    const [showHidden, setShowHidden] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage?.getItem('fileViewer.showHidden') === '1';
    });
    const toggleShowHidden = React.useCallback(() => {
        setShowHidden(prev => {
            const next = !prev;
            try { window.localStorage?.setItem('fileViewer.showHidden', next ? '1' : '0'); } catch {}
            return next;
        });
    }, []);

    // Editor font size — toolbar A-/A+ buttons clamp to [10, 24] and persist.
    const [fontSize, setFontSize] = React.useState<number>(() => {
        if (typeof window === 'undefined') return 14;
        const saved = parseInt(window.localStorage?.getItem('fileViewer.fontSize') ?? '', 10);
        return Number.isFinite(saved) && saved >= 10 && saved <= 24 ? saved : 14;
    });
    const adjustFontSize = React.useCallback((delta: number) => {
        setFontSize(prev => {
            const next = Math.max(10, Math.min(24, prev + delta));
            try { window.localStorage?.setItem('fileViewer.fontSize', String(next)); } catch {}
            return next;
        });
    }, []);

    // Preview-mode for markdown files: the toolbar 'Preview' button toggles
    // the right pane between Monaco editor and a rendered MarkdownView. Keyed
    // by tab id so each open file remembers its own preview state.
    const [previewTabIds, setPreviewTabIds] = React.useState<Set<string>>(() => new Set());

    const tabsRef = React.useRef<Tab[]>(tabs);
    React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);

    const activeTab = React.useMemo(
        () => tabs.find(t => t.id === activeTabId) ?? null,
        [tabs, activeTabId],
    );

    // Monaco editor instance — captured via onMount, used by the toolbar to
    // drive built-in find/replace/gotoLine actions.
    const editorRef = React.useRef<any>(null);
    const handleEditorMount = React.useCallback((editor: unknown) => {
        editorRef.current = editor;
    }, []);
    const runEditorAction = React.useCallback((actionId: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus?.();
        const action = editor.getAction?.(actionId);
        if (action?.run) action.run();
    }, []);

    const openFile = React.useCallback(async (path: string) => {
        // Already open? Just switch.
        const existing = tabsRef.current.find(t => t.path === path);
        if (existing) {
            setActiveTabId(existing.id);
            return;
        }
        setLoadingPath(path);
        try {
            const resp = await readFile(path);
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
    }, [readFile]);

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
            const resp = await writeFile(tab.path, encodeUtf8Base64(tab.content));
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
    }, [writeFile]);

    const saveAllDirty = React.useCallback(async () => {
        const dirtyTabs = tabsRef.current.filter(t => t.dirty);
        for (const tab of dirtyTabs) {
            const ok = await saveTab(tab.id);
            if (!ok) return;
        }
    }, [saveTab]);

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

    // Refresh the active tab's content from disk; if dirty, ask the user first.
    const refreshActiveTab = React.useCallback(async () => {
        const tab = activeTab;
        if (!tab) return;
        if (tab.dirty) {
            const decision = await askSaveDiscardCancel(
                tx('fileViewer.unsavedChangesTitle'),
                tx('fileViewer.unsavedChangesSingle', { name: basename(tab.path) }),
            );
            if (decision === 'cancel') return;
            if (decision === 'save') {
                const ok = await saveTab(tab.id);
                if (!ok) return;
            }
        }
        const resp = await readFile(tab.path);
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
        setTabs(prev => prev.map(p => p.id === tab.id
            ? { ...p, content: text, original: text, dirty: false }
            : p,
        ));
    }, [activeTab, saveTab, readFile]);

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

    const tree = useDirectoryTree(entityId, rootPath, listDirectoryFn, showHidden);

    // --- Tree-toolbar handlers ---
    const goUpOneLevel = React.useCallback(() => {
        const parent = dirname(rootPath);
        if (parent && parent !== rootPath) setRootPath(parent);
    }, [rootPath]);

    const refreshTreeRoot = React.useCallback(() => {
        void tree.refresh(rootPath);
    }, [tree, rootPath]);

    // Inline 'new file/folder' dialog. Replaces the chain of native browser
    // prompt + multi-button picker that looked terrible. Renders as an
    // absolutely-positioned overlay inside the modal portal so it sits on
    // top of everything without any stacking-context fighting.
    type NewDialogState =
        | null
        | { stage: 'pick' }
        | { stage: 'name'; type: 'file' | 'dir'; value: string; saving: boolean };
    const [newDialog, setNewDialog] = React.useState<NewDialogState>(null);

    const handleNewClick = React.useCallback(() => {
        setNewDialog({ stage: 'pick' });
    }, []);

    const submitNewName = React.useCallback(async () => {
        if (!newDialog || newDialog.stage !== 'name') return;
        const trimmed = newDialog.value.trim();
        if (!trimmed) return;
        setNewDialog({ ...newDialog, saving: true });
        const target = joinPath(rootPath, trimmed);
        const resp = newDialog.type === 'file'
            ? await createFile(target, '')
            : await createDirectory(target);
        if (!resp.success) {
            Modal.alert(t('common.error'), resp.error || tx(newDialog.type === 'file' ? 'fileViewer.fileExists' : 'fileViewer.dirExists'));
            setNewDialog({ ...newDialog, saving: false });
            return;
        }
        setNewDialog(null);
        await tree.refresh(rootPath);
    }, [newDialog, rootPath, createFile, createDirectory, tree]);

    const [searchOpen, setSearchOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const toggleSearch = React.useCallback(() => {
        setSearchOpen(prev => {
            if (prev) setSearchQuery('');
            return !prev;
        });
    }, []);

    // --- Context-menu state for right-click on tree entries ---
    const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);

    // Close context menu on any document click outside it.
    React.useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        // Defer attaching to the next tick so the click that opened the menu
        // (if it bubbled) doesn't immediately close it.
        const id = setTimeout(() => {
            window.addEventListener('click', handler);
            window.addEventListener('contextmenu', handler);
        }, 0);
        return () => {
            clearTimeout(id);
            window.removeEventListener('click', handler);
            window.removeEventListener('contextmenu', handler);
        };
    }, [contextMenu]);

    const handleEntryContextMenu = React.useCallback(
        (entry: { path: string; name: string; type: 'file' | 'dir' }, x: number, y: number) => {
            setContextMenu({ x, y, entry });
        },
        [],
    );

    const handleRename = React.useCallback(async (entry: { path: string; name: string; type: 'file' | 'dir' }) => {
        setContextMenu(null);
        const newName = await Modal.prompt(
            tx('fileViewer.rename'),
            tx('fileViewer.renamePrompt'),
            { defaultValue: entry.name, confirmText: tx('common.ok'), cancelText: tx('common.cancel') },
        );
        const trimmed = newName?.trim();
        if (!trimmed || trimmed === entry.name) return;
        const parent = dirname(entry.path);
        const target = joinPath(parent, trimmed);
        const resp = await renameFn(entry.path, target);
        if (!resp.success) {
            Modal.alert(t('common.error'), resp.error || tx('fileViewer.saveFailed'));
            return;
        }
        await tree.refresh(parent);
    }, [renameFn, tree]);

    const handleDownload = React.useCallback(async (entry: { path: string; name: string; type: 'file' | 'dir' }) => {
        setContextMenu(null);
        const resp = await readFile(entry.path);
        if (!resp.success || !resp.content) {
            Modal.alert(t('common.error'), resp.error || tx('fileViewer.openFailed'));
            return;
        }
        const bytes = decodeBase64Bytes(resp.content);
        downloadBlob(entry.name, bytes);
    }, [readFile]);

    const handleCompress = React.useCallback(async (entry: { path: string; name: string; type: 'file' | 'dir' }) => {
        setContextMenu(null);
        const parent = dirname(entry.path);
        const result = await compressAndDownload({
            bash: bashFn,
            readFile,
            cwd: parent,
            names: [entry.name],
            confirmLargeMb: async (sizeMb) => {
                return window.confirm(
                    tx('browser.compressLargeWarning', { sizeMb: sizeMb.toFixed(1) }),
                );
            },
        });
        if (!result.success && result.error) {
            Modal.alert(t('common.error'), result.error);
        } else if (result.success) {
            // No toast helper available in this modal — a bare alert would be
            // more disruptive than the browser's own download chrome, so we
            // stay silent on success.
        }
    }, [bashFn, readFile]);

    const handleUpload = React.useCallback((entry: { path: string; name: string; type: 'file' | 'dir' }) => {
        setContextMenu(null);
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none';
        const finalize = () => {
            try { document.body.removeChild(input); } catch {}
        };
        input.onchange = async () => {
            const files = Array.from(input.files ?? []);
            if (files.length === 0) { finalize(); return; }
            const errors: string[] = [];
            for (const file of files) {
                // 50MB soft warning gate.
                if (file.size > 50 * 1024 * 1024) {
                    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
                    const ok = window.confirm(
                        `${file.name} is ~${sizeMb} MB. Upload may be slow. Continue?`,
                    );
                    if (!ok) continue;
                }
                const target = joinPath(entry.path, file.name);

                // Probe for existing file: a successful read means the path
                // already resolves to a readable file. Skip overwrite prompt
                // on read errors (probe is best-effort, not authoritative).
                const probe = await readFile(target);
                if (probe.success) {
                    const ok = window.confirm(tx('fileViewer.uploadOverwriteConfirm', { name: file.name }));
                    if (!ok) continue;
                }

                let base64: string;
                try {
                    const buf = await file.arrayBuffer();
                    base64 = bytesToBase64(new Uint8Array(buf));
                } catch (e) {
                    errors.push(`${file.name}: ${e instanceof Error ? e.message : 'read failed'}`);
                    continue;
                }
                const writeRes = await writeFile(target, base64);
                if (!writeRes.success) {
                    errors.push(`${file.name}: ${writeRes.error || 'upload failed'}`);
                }
            }
            if (errors.length > 0) {
                Modal.alert(tx('fileViewer.uploadFailed'), errors.join('\n'));
            }
            await tree.refresh(entry.path);
            finalize();
        };
        document.body.appendChild(input);
        input.click();
    }, [readFile, writeFile, tree]);

    const handleDelete = React.useCallback(async (entry: { path: string; name: string; type: 'file' | 'dir' }) => {
        setContextMenu(null);
        const isDir = entry.type === 'dir';
        const titleKey = isDir ? 'fileViewer.deleteDir' : 'fileViewer.deleteFile';
        const confirmKey = isDir ? 'fileViewer.deleteDirConfirm' : 'fileViewer.deleteFileConfirm';
        const confirmed = await Modal.confirm(
            tx(titleKey),
            tx(confirmKey, { name: entry.name }),
            { confirmText: tx(titleKey), cancelText: tx('common.cancel'), destructive: true },
        );
        if (!confirmed) return;
        const resp = isDir
            ? await deleteDirectory(entry.path)
            : await deleteFile(entry.path);
        if (!resp.success) {
            Modal.alert(t('common.error'), resp.error || tx('fileViewer.saveFailed'));
            return;
        }
        // Close any open tabs for files under the deleted path.
        setTabs(prev => prev.filter(t => !(t.path === entry.path || (isDir && t.path.startsWith(entry.path + '/')))));
        await tree.refresh(dirname(entry.path));
    }, [deleteDirectory, deleteFile, tree]);

    if (!visible) return null;

    const hasDirty = tabs.some(t => t.dirty);

    // Render through a React portal anchored on document.body. Without the
    // portal, even with position:fixed + zIndex:99999, the modal stays trapped
    // inside whatever ancestor stacking context the React-Navigation drawer /
    // Sidebar / RightPanel established (any `transform`, `filter`, `will-change`
    // on an ancestor pins fixed elements to that container, not the viewport).
    // The portal physically detaches the DOM subtree so it can truly cover the
    // whole viewport including the Sidebar.
    return createPortal(
        <View
            // @ts-ignore — RN web accepts CSS `position: fixed`. With the portal
            // above, the body is the parent so fixed = viewport-anchored.
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
                {/* Global IDE toolbar (B). Sits above the tabbar; close button moved here. */}
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    gap: 2,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                }}>
                    <ToolbarIconButton
                        icon="save-outline"
                        label={tx('fileViewer.save')}
                        disabled={!activeTab || !activeTab.dirty || saving}
                        onPress={() => { if (activeTab) void saveTab(activeTab.id); }}
                    />
                    <ToolbarIconButton
                        icon="sync-outline"
                        label={tx('fileViewer.saveAll')}
                        disabled={!hasDirty || saving}
                        onPress={() => { void saveAllDirty(); }}
                    />
                    <ToolbarIconButton
                        icon="reload"
                        label={tx('fileViewer.refresh')}
                        disabled={!activeTab}
                        onPress={() => { void refreshActiveTab(); }}
                    />
                    <View style={{ width: 1, height: 18, backgroundColor: theme.colors.divider, marginHorizontal: 6 }} />
                    <ToolbarIconButton
                        icon="search"
                        label={tx('fileViewer.find')}
                        disabled={!activeTab}
                        onPress={() => runEditorAction('actions.find')}
                    />
                    <ToolbarIconButton
                        icon="swap-horizontal"
                        label={tx('fileViewer.replace')}
                        disabled={!activeTab}
                        onPress={() => runEditorAction('editor.action.startFindReplaceAction')}
                    />
                    <ToolbarIconButton
                        icon="navigate-outline"
                        label={tx('fileViewer.gotoLine')}
                        disabled={!activeTab}
                        onPress={() => runEditorAction('editor.action.gotoLine')}
                    />
                    {/* Markdown preview toggle — visible only on .md tabs. */}
                    {activeTab && activeTab.language === 'markdown' && (
                        <ToolbarIconButton
                            icon={previewTabIds.has(activeTab.id) ? 'create-outline' : 'eye-outline'}
                            label={previewTabIds.has(activeTab.id) ? 'Edit' : 'Preview'}
                            onPress={() => {
                                setPreviewTabIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(activeTab.id)) next.delete(activeTab.id);
                                    else next.add(activeTab.id);
                                    return next;
                                });
                            }}
                        />
                    )}
                    {/* Font-size controls. Persisted to localStorage. */}
                    <ToolbarIconButton
                        icon="remove"
                        label={`Smaller (${fontSize}px)`}
                        disabled={fontSize <= 10}
                        onPress={() => adjustFontSize(-1)}
                    />
                    <View style={{
                        minWidth: 28,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>
                            {fontSize}
                        </Text>
                    </View>
                    <ToolbarIconButton
                        icon="add"
                        label={`Larger (${fontSize}px)`}
                        disabled={fontSize >= 24}
                        onPress={() => adjustFontSize(1)}
                    />
                    <View style={{ flex: 1 }} />
                    <Pressable
                        onPress={() => { void requestClose(); }}
                        hitSlop={10}
                        style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            opacity: pressed ? 0.5 : 1,
                        })}
                        accessibilityLabel={tx('fileViewer.close')}
                    >
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

                {/* Tabbar (close moved to global toolbar above). */}
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
                </View>

                {/* Body: left tree + right editor. */}
                <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
                    <View style={{
                        width: treeWidth,
                        borderRightWidth: 1,
                        borderRightColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                        flexDirection: 'column',
                        // Needed for ResizableHandle's absolute positioning to anchor here.
                        position: 'relative',
                    }}>
                        <ResizableHandle
                            side="right"
                            width={treeWidth}
                            minWidth={150}
                            maxWidth={600}
                            onResize={setTreeWidth}
                            onCommit={persistTreeWidth}
                        />
                        {/* Tree toolbar (A). */}
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: 6,
                            paddingVertical: 4,
                            gap: 2,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                        }}>
                            <ToolbarIconButton
                                icon="arrow-up"
                                label={tx('fileViewer.upOneLevel')}
                                onPress={goUpOneLevel}
                                compact
                            />
                            <ToolbarIconButton
                                icon="refresh"
                                label={tx('fileViewer.refreshTree')}
                                onPress={refreshTreeRoot}
                                compact
                            />
                            <ToolbarIconButton
                                icon="add"
                                label={tx('fileViewer.newItem')}
                                onPress={handleNewClick}
                                compact
                            />
                            <ToolbarIconButton
                                icon={showHidden ? 'eye' : 'eye-off-outline'}
                                label={showHidden ? 'Hide hidden' : 'Show hidden'}
                                onPress={toggleShowHidden}
                                compact
                            />
                            <ToolbarIconButton
                                icon="search"
                                label={tx('fileViewer.search')}
                                onPress={toggleSearch}
                                compact
                                active={searchOpen}
                            />
                        </View>
                        {searchOpen && (
                            <View style={{
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                borderBottomWidth: 1,
                                borderBottomColor: theme.colors.divider,
                            }}>
                                <TextInput
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    placeholder={tx('fileViewer.search')}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoFocus
                                    style={{
                                        fontSize: 12,
                                        color: theme.colors.text,
                                        backgroundColor: theme.colors.surface,
                                        borderRadius: 4,
                                        paddingHorizontal: 8,
                                        paddingVertical: 4,
                                        ...Typography.default(),
                                    }}
                                />
                            </View>
                        )}
                        <DirectoryTreePanel
                            tree={tree}
                            onSelectFile={(p) => { void openFile(p); }}
                            onContextMenuEntry={handleEntryContextMenu}
                            searchQuery={searchQuery}
                            fontSize={fontSize}
                        />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        {activeTab ? (
                            previewTabIds.has(activeTab.id) && activeTab.language === 'markdown' ? (
                                <ScrollView
                                    style={{ flex: 1, backgroundColor: theme.colors.surface }}
                                    contentContainerStyle={{ padding: 24 }}
                                >
                                    <MarkdownView markdown={activeTab.content} />
                                </ScrollView>
                            ) : (
                                <MonacoEditor
                                    value={activeTab.content}
                                    onChange={handleEditorChange}
                                    path={activeTab.path}
                                    theme="vs-dark"
                                    height="100%"
                                    onMount={handleEditorMount}
                                    fontSize={fontSize}
                                />
                            )
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
                    {saving && <ActivityIndicator size="small" />}
                </View>
            </View>

            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onRename={handleRename}
                    onDownload={handleDownload}
                    onCompress={handleCompress}
                    onUpload={handleUpload}
                    onDelete={handleDelete}
                />
            )}

            {newDialog && (
                <NewDialog
                    state={newDialog}
                    onSetState={setNewDialog}
                    onSubmit={submitNewName}
                />
            )}
        </View>,
        document.body,
    );
}

interface NewDialogProps {
    state: NonNullable<NewDialogStateExternal>;
    onSetState: (s: NewDialogStateExternal) => void;
    onSubmit: () => void;
}
type NewDialogStateExternal =
    | null
    | { stage: 'pick' }
    | { stage: 'name'; type: 'file' | 'dir'; value: string; saving: boolean };

function NewDialog({ state, onSetState, onSubmit }: NewDialogProps) {
    const { theme } = useUnistyles();
    const inputRef = React.useRef<TextInput>(null);

    React.useEffect(() => {
        // Focus the input as soon as we transition to the name stage.
        if (state.stage === 'name') {
            const id = setTimeout(() => inputRef.current?.focus(), 30);
            return () => clearTimeout(id);
        }
    }, [state.stage]);

    // Esc closes; Enter submits (handled on the input itself).
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onSetState(null);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onSetState]);

    return (
        <View
            style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                zIndex: 100000,
                justifyContent: 'center',
                alignItems: 'center',
            }}
            // @ts-ignore — RN-web onClick
            onClick={(e: any) => { if (e.target === e.currentTarget) onSetState(null); }}
        >
            <Pressable
                onPress={() => onSetState(null)}
                style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                }}
            />
            <View style={{
                width: 360,
                backgroundColor: theme.colors.surface,
                borderRadius: 10,
                padding: 16,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.25,
                shadowRadius: 16,
                elevation: 12,
            }}>
                {state.stage === 'pick' ? (
                    <>
                        <Text style={{ fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold'), marginBottom: 12 }}>
                            {t('fileViewer.newItem' as any)}
                        </Text>
                        <Pressable
                            onPress={() => onSetState({ stage: 'name', type: 'file', value: '', saving: false })}
                            style={({ pressed }) => ({
                                paddingVertical: 10,
                                paddingHorizontal: 8,
                                borderRadius: 6,
                                backgroundColor: pressed ? theme.colors.surfaceHigh : 'transparent',
                            })}
                        >
                            <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                {t('fileViewer.newFile' as any)}
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => onSetState({ stage: 'name', type: 'dir', value: '', saving: false })}
                            style={({ pressed }) => ({
                                paddingVertical: 10,
                                paddingHorizontal: 8,
                                borderRadius: 6,
                                backgroundColor: pressed ? theme.colors.surfaceHigh : 'transparent',
                            })}
                        >
                            <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                {t('fileViewer.newFolder' as any)}
                            </Text>
                        </Pressable>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                            <Pressable
                                onPress={() => onSetState(null)}
                                style={({ pressed }) => ({
                                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6,
                                    opacity: pressed ? 0.7 : 1,
                                })}
                            >
                                <Text style={{ fontSize: 14, color: theme.colors.textSecondary, ...Typography.default() }}>
                                    {t('common.cancel')}
                                </Text>
                            </Pressable>
                        </View>
                    </>
                ) : (
                    <>
                        <Text style={{ fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold'), marginBottom: 4 }}>
                            {t((state.type === 'file' ? 'fileViewer.newFile' : 'fileViewer.newFolder') as any)}
                        </Text>
                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default(), marginBottom: 10 }}>
                            {t((state.type === 'file' ? 'fileViewer.newFilePrompt' : 'fileViewer.newFolderPrompt') as any)}
                        </Text>
                        <TextInput
                            ref={inputRef}
                            value={state.value}
                            onChangeText={(v) => onSetState({ ...state, value: v })}
                            onSubmitEditing={onSubmit}
                            editable={!state.saving}
                            placeholder={state.type === 'file' ? 'name.ext' : 'folder-name'}
                            placeholderTextColor={theme.colors.textSecondary}
                            style={{
                                borderWidth: 1,
                                borderColor: theme.colors.divider,
                                borderRadius: 6,
                                paddingHorizontal: 10,
                                paddingVertical: 8,
                                fontSize: 14,
                                color: theme.colors.text,
                                backgroundColor: theme.colors.surfaceHigh,
                                marginBottom: 14,
                                outlineStyle: 'none' as any,
                            }}
                        />
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                            <Pressable
                                onPress={() => onSetState(null)}
                                disabled={state.saving}
                                style={({ pressed }) => ({
                                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6,
                                    opacity: pressed ? 0.7 : 1,
                                })}
                            >
                                <Text style={{ fontSize: 14, color: theme.colors.textSecondary, ...Typography.default() }}>
                                    {t('common.cancel')}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={onSubmit}
                                disabled={state.saving || !state.value.trim()}
                                style={({ pressed }) => ({
                                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6,
                                    backgroundColor: theme.colors.button.primary.background,
                                    opacity: state.saving || !state.value.trim() ? 0.5 : (pressed ? 0.85 : 1),
                                })}
                            >
                                {state.saving
                                    ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                                    : <Text style={{ fontSize: 14, color: theme.colors.button.primary.tint, ...Typography.default('semiBold') }}>
                                        {t('common.ok')}
                                      </Text>
                                }
                            </Pressable>
                        </View>
                    </>
                )}
            </View>
        </View>
    );
}

interface ToolbarIconButtonProps {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    disabled?: boolean;
    compact?: boolean;
    active?: boolean;
}

function ToolbarIconButton({ icon, label, onPress, disabled, compact, active }: ToolbarIconButtonProps) {
    const { theme } = useUnistyles();
    const padH = compact ? 6 : 8;
    const padV = compact ? 4 : 6;
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={label}
            // @ts-ignore — RN web accepts the DOM `title` attribute for hover tooltip.
            title={label}
            style={({ pressed, hovered }: any) => ({
                paddingHorizontal: padH,
                paddingVertical: padV,
                borderRadius: 4,
                opacity: disabled ? 0.4 : (pressed ? 0.6 : 1),
                backgroundColor: active
                    ? theme.colors.surfacePressed
                    : (hovered && !disabled ? theme.colors.surfacePressed : 'transparent'),
            })}
        >
            <Ionicons name={icon} size={compact ? 14 : 16} color={theme.colors.text} />
        </Pressable>
    );
}

interface ContextMenuProps {
    state: ContextMenuState;
    onRename: (entry: ContextMenuState['entry']) => void;
    onDownload: (entry: ContextMenuState['entry']) => void;
    onCompress: (entry: ContextMenuState['entry']) => void;
    onUpload: (entry: ContextMenuState['entry']) => void;
    onDelete: (entry: ContextMenuState['entry']) => void;
}

function ContextMenu({ state, onRename, onDownload, onCompress, onUpload, onDelete }: ContextMenuProps) {
    const { theme } = useUnistyles();
    const isDir = state.entry.type === 'dir';
    return (
        <View
            // @ts-ignore — fixed positioning anchors the menu to viewport coordinates.
            style={{
                position: 'fixed' as any,
                top: state.y,
                left: state.x,
                zIndex: 100000,
                backgroundColor: theme.colors.surface,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                paddingVertical: 4,
                minWidth: 160,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.25,
                shadowRadius: 12,
                elevation: 16,
            }}
            // @ts-ignore — DOM event to stop the document-level click closer.
            onClick={(e: any) => e.stopPropagation?.()}
        >
            <ContextMenuItem
                icon="pencil"
                label={tx('fileViewer.rename')}
                onPress={() => onRename(state.entry)}
            />
            {!isDir && (
                <ContextMenuItem
                    icon="download-outline"
                    label={tx('fileViewer.download')}
                    onPress={() => onDownload(state.entry)}
                />
            )}
            {isDir && (
                <ContextMenuItem
                    icon="archive-outline"
                    label={tx('browser.compressDownload')}
                    onPress={() => onCompress(state.entry)}
                />
            )}
            {isDir && (
                <ContextMenuItem
                    icon="cloud-upload-outline"
                    label={tx('fileViewer.upload')}
                    onPress={() => onUpload(state.entry)}
                />
            )}
            <ContextMenuItem
                icon="trash-outline"
                label={isDir ? tx('fileViewer.deleteDir') : tx('fileViewer.deleteFile')}
                onPress={() => onDelete(state.entry)}
                destructive
            />
        </View>
    );
}

function ContextMenuItem({
    icon,
    label,
    onPress,
    destructive,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    destructive?: boolean;
}) {
    const { theme } = useUnistyles();
    const color = destructive ? (theme.colors.textDestructive ?? '#dc2626') : theme.colors.text;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed, hovered }: any) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingVertical: 6,
                gap: 8,
                backgroundColor: hovered || pressed ? theme.colors.surfacePressed : 'transparent',
            })}
        >
            <Ionicons name={icon} size={14} color={color} />
            <Text style={{ fontSize: 13, color, ...Typography.default() }}>{label}</Text>
        </Pressable>
    );
}

interface DirectoryTreePanelProps {
    tree: ReturnType<typeof useDirectoryTree>;
    onSelectFile: (path: string) => void;
    onContextMenuEntry: (
        entry: { path: string; name: string; type: 'file' | 'dir' },
        x: number,
        y: number,
    ) => void;
    searchQuery: string;
    /** Tree entry font size — synced with the editor toolbar A-/A+. */
    fontSize: number;
}

function DirectoryTreePanel({ tree, onSelectFile, onContextMenuEntry, searchQuery, fontSize }: DirectoryTreePanelProps) {
    const { theme } = useUnistyles();
    const { tree: nodes, expand, collapse, isLoading, errors } = tree;

    const visibleNodes = React.useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return nodes;
        return nodes.filter(n => n.entry.name.toLowerCase().includes(q));
    }, [nodes, searchQuery]);

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
                    // @ts-ignore — RN web supports onContextMenu DOM event.
                    onContextMenu={(e: any) => {
                        e.preventDefault?.();
                        e.stopPropagation?.();
                        onContextMenuEntry(
                            { path: entry.path, name: entry.name, type: entry.type },
                            e.clientX,
                            e.clientY,
                        );
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
                        ? <Ionicons name={expanded ? 'caret-down' : 'caret-forward'} size={11} color={theme.colors.textSecondary} />
                        : <View style={{ width: 11 }} />}
                    {isDir
                        ? <Ionicons name={expanded ? 'folder-open' : 'folder'} size={14} color="#FFC233" />
                        : <FileIcon fileName={entry.name} size={14} />}
                    <Text
                        numberOfLines={1}
                        style={{ marginLeft: 4, fontSize, color: theme.colors.text, ...Typography.default(), flex: 1 }}
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
            {visibleNodes.map(n => renderNode(n, 0))}
        </ScrollView>
    );
}
