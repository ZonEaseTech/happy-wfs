import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Platform, Pressable, Share } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Text } from '@/components/StyledText';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { CodeEditor } from '@/components/CodeEditor';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { machineReadFile, sessionReadFile, sessionBash, sessionWriteFile } from '@/sync/ops';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { DropdownMenu } from '@/components/DropdownMenu';
import { DesktopModalShell } from '@/components/DesktopModalShell';
import EditScreen from '@/app/(app)/session/[id]/edit';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { getSession, useSetting } from '@/sync/storage';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { FileIcon } from '@/components/FileIcon';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { storeTempText } from '@/sync/persistence';
import * as Clipboard from 'expo-clipboard';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { shellEscape } from '@/utils/shellEscape';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { getImageMimeType, getVideoMimeType, isPreviewableHtml, isPreviewableImage, isPreviewableVideo, isTemporaryFilePath } from '@/utils/fileViewer';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { isMachineScopedSpreadsheetPath } from '@/components/markdown/markdownLinkUtils';
import { Image } from 'expo-image';
import { base64ToUint8Array, getDownloadMimeType, sanitizeDownloadFileName } from '@/utils/fileViewerDownload';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ImageViewer } from '@/components/ImageViewer';
import type { ImageViewerImage } from '@/components/ImageViewer';

const WebView = require('react-native-webview').default;

function getRepoRelativePath(filePath: string, repoPath: string): string {
    if (repoPath && filePath.startsWith(`${repoPath}/`)) {
        return filePath.substring(repoPath.length + 1);
    }
    return filePath;
}

interface FileContent {
    content: string;
    encoding: 'utf8' | 'base64';
    isBinary: boolean;
}

function HtmlPreview(props: { html: string; fileName: string }) {
    if (Platform.OS === 'web') {
        return (
            <View style={styles.htmlPreviewContainer}>
                {React.createElement('iframe', {
                    title: props.fileName || t('machineEdit.previewMode'),
                    srcDoc: props.html,
                    sandbox: 'allow-forms allow-modals allow-popups allow-scripts',
                    style: {
                        border: '0',
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'white',
                    },
                } as any)}
            </View>
        );
    }

    return (
        <WebView
            source={{ html: props.html }}
            style={styles.htmlPreviewWebView}
            originWhitelist={['*']}
            javaScriptEnabled={true}
            scrollEnabled={true}
        />
    );
}


function VideoPreview(props: { uri: string; fileName: string }) {
    if (Platform.OS === 'web') {
        return (
            <View style={styles.videoPreviewContainer}>
                {React.createElement('video', {
                    controls: true,
                    playsInline: true,
                    src: props.uri,
                    style: {
                        maxWidth: '100%',
                        maxHeight: '100%',
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'black',
                    },
                } as any)}
            </View>
        );
    }

    const escapedTitle = props.fileName.replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    }[char] || char));
    const html = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
body { display: flex; align-items: center; justify-content: center; }
video { width: 100%; height: 100%; object-fit: contain; background: #000; }
</style>
<title>${escapedTitle}</title>
</head>
<body>
<video controls playsinline webkit-playsinline preload="metadata" src="${props.uri}"></video>
</body>
</html>`;

    return (
        <WebView
            source={{ html }}
            style={styles.videoPreviewWebView}
            originWhitelist={['*']}
            javaScriptEnabled={true}
            allowsFullscreenVideo={true}
            mediaPlaybackRequiresUserAction={false}
        />
    );
}

function parsePositiveInt(value: string | string[] | undefined): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getShareOrigin(): string {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }
    return 'https://happy.weifashi.cn';
}

function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

// Diff display component
const DiffDisplay: React.FC<{ diffContent: string }> = ({ diffContent }) => {
    const { theme } = useUnistyles();
    const lines = diffContent.split('\n');

    return (
        <View>
            {lines.map((line, index) => {
                const baseStyle = { ...Typography.mono(), fontSize: 14, lineHeight: 20 };
                let lineStyle: any = baseStyle;
                let backgroundColor = 'transparent';

                if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.addedText };
                    backgroundColor = theme.colors.diff.addedBg;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.removedText };
                    backgroundColor = theme.colors.diff.removedBg;
                } else if (line.startsWith('@@')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.hunkHeaderText, fontWeight: '600' };
                    backgroundColor = theme.colors.diff.hunkHeaderBg;
                } else if (line.startsWith('+++') || line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.text, fontWeight: '600' };
                } else {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.contextText };
                }

                return (
                    <View
                        key={index}
                        style={{
                            backgroundColor,
                            paddingHorizontal: 8,
                            paddingVertical: 1,
                            borderLeftWidth: line.startsWith('+') && !line.startsWith('+++') ? 3 :
                                           line.startsWith('-') && !line.startsWith('---') ? 3 : 0,
                            borderLeftColor: line.startsWith('+') && !line.startsWith('+++') ? theme.colors.diff.addedBorder : theme.colors.diff.removedBorder
                        }}
                    >
                        <Text style={lineStyle}>
                            {line || ' '}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
};

interface FileScreenProps {
    /** When provided, takes precedence over route param. Used in embedded mode. */
    sessionId?: string;
    /** Base64-encoded path (same shape as URL `?path=...`). Required in embedded mode. */
    encodedPath?: string;
    /** When true, skip Stack.Screen header + render inline back bar instead. */
    embedded?: boolean;
    /** Called from the inline back button in embedded mode. */
    onBack?: () => void;
}

export default function FileScreen(props?: FileScreenProps) {
    const route = useRoute();
    const router = useRouter();
    const { theme } = useUnistyles();
    const urlParams = useLocalSearchParams<{ id: string }>();
    const sessionId = props?.sessionId ?? urlParams.id;
    const embedded = !!props?.embedded;
    const searchParams = useLocalSearchParams();
    const encodedPath = props?.encodedPath ?? (searchParams.path as string);
    const ref = searchParams.ref as string | undefined;
    const preferredView = searchParams.view as 'file' | 'diff' | 'preview' | undefined;
    const machineFileReaderId = typeof searchParams.machineId === 'string' ? searchParams.machineId : undefined;
    const isStaged = searchParams.staged === '1';
    const requestedLine = parsePositiveInt(searchParams.line);
    const requestedColumn = parsePositiveInt(searchParams.column);
    let filePath = '';

    // Decode base64 path with error handling (UTF-8 safe)
    try {
        if (encodedPath) {
            const binaryString = atob(encodedPath);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            filePath = new TextDecoder('utf-8').decode(bytes);
        }
    } catch (error) {
        console.error('Failed to decode file path:', error);
        filePath = encodedPath || ''; // Fallback to original path if decoding fails
    }

    const session = getSession(sessionId!);
    const displayPath = formatPathRelativeToHome(filePath, session?.metadata?.homeDir);

    const sessionPath = session?.metadata?.path || '';

    // Multi-repo: detect which repo this file belongs to for correct git cwd
    const workspaceRepos = getWorkspaceRepos(session?.metadata);
    const fileRepo = workspaceRepos.find(r => filePath.startsWith(r.path + '/'));
    const gitCwd = fileRepo?.path || sessionPath;

    const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
    const [diffContent, setDiffContent] = React.useState<string | null>(null);
    const [displayMode, setDisplayMode] = React.useState<'file' | 'diff' | 'preview'>('diff');
    const [imageBase64, setImageBase64] = React.useState<string | null>(null);
    const [imageMimeType, setImageMimeType] = React.useState('image/png');
    const [videoBase64, setVideoBase64] = React.useState<string | null>(null);
    const [videoMimeType, setVideoMimeType] = React.useState('video/mp4');
    const [imageViewerVisible, setImageViewerVisible] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);
    // Anchor for the embedded "..." dropdown menu (web). Native + standalone
    // /file route still use the bottom-sheet ActionMenuModal.
    const menuTriggerRef = React.useRef<View>(null);
    const useDropdownMenu = !!props?.embedded && Platform.OS === 'web';
    // Embedded inline edit mode: when true, render EditScreen inside this
    // panel instead of pushing /edit. Only meaningful in embedded mode.
    const [editMode, setEditMode] = React.useState(false);
    const wordWrap = useSetting('wrapLinesInDiffs');

    const fileName = filePath.split('/').pop() || filePath;
    const isPreviewImageFile = isPreviewableImage(filePath);
    const isPreviewHtmlFile = isPreviewableHtml(filePath);
    const isPreviewVideoFile = isPreviewableVideo(filePath);
    const isPreviewMarkdownFile = /\.(md|markdown)$/i.test(filePath);
    const canReadFromMachine = !!machineFileReaderId && (isTemporaryFilePath(filePath) || isMachineScopedSpreadsheetPath(filePath));
    const imagePreviewUri = imageBase64 ? `data:${imageMimeType};base64,${imageBase64}` : null;
    const videoPreviewUri = videoBase64 ? `data:${videoMimeType};base64,${videoBase64}` : null;
    const imageViewerItems: ImageViewerImage[] = imagePreviewUri ? [{ uri: imagePreviewUri }] : [];

    // Relative path for display/copy (relative to repo, not workspace root)
    const relativePath = React.useMemo(() => {
        if (gitCwd && filePath.startsWith(gitCwd + '/')) {
            return filePath.substring(gitCwd.length + 1);
        }
        if (sessionPath && filePath.startsWith(sessionPath + '/')) {
            return filePath.substring(sessionPath.length + 1);
        }
        return filePath;
    }, [filePath, gitCwd, sessionPath]);

    const readCurrentFileBase64 = React.useCallback(async (): Promise<string | null> => {
        if (!sessionId || ref) {
            Modal.alert(t('common.error'), 'Cannot download this file version');
            return null;
        }
        const response = canReadFromMachine
            ? await machineReadFile(machineFileReaderId!, filePath)
            : await sessionReadFile(sessionId, filePath);
        if (!response.success || !response.content) {
            Modal.alert(t('common.error'), response.error || 'Failed to download file');
            return null;
        }
        return response.content;
    }, [canReadFromMachine, filePath, machineFileReaderId, ref, sessionId]);

    const handleDownload = React.useCallback(async () => {
        try {
            const base64 = await readCurrentFileBase64();
            if (!base64) return;

            const mimeType = getDownloadMimeType(filePath);
            const downloadName = sanitizeDownloadFileName(fileName);

            if (Platform.OS === 'web') {
                const bytes = base64ToUint8Array(base64);
                const arrayBuffer = new ArrayBuffer(bytes.byteLength);
                new Uint8Array(arrayBuffer).set(bytes);
                const blob = new Blob([arrayBuffer], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = downloadName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return;
            }

            const tempFile = new File(Paths.cache, `download-${Date.now()}-${downloadName}`);
            tempFile.create({ overwrite: true, intermediates: true });
            tempFile.write(base64, { encoding: 'base64' });

            try {
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(tempFile.uri, {
                        mimeType,
                        dialogTitle: fileName,
                    });
                    return;
                }
                await Share.share({ title: fileName, message: fileName });
            } finally {
                try {
                    tempFile.delete();
                } catch {
                    // ignore cleanup errors
                }
            }
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : 'Failed to download file');
        }
    }, [fileName, filePath, readCurrentFileBase64]);

    const buildShareLink = React.useCallback((): string => {
        const pathParam = encodedPath
            ? encodeURIComponent(encodedPath)
            : encodeURIComponent(btoa(new TextEncoder().encode(filePath).reduce((text, byte) => text + String.fromCharCode(byte), '')));
        const queryParams = [
            `path=${pathParam}`,
            `view=${encodeURIComponent(preferredView || displayMode)}`,
        ];
        if (ref) queryParams.push(`ref=${encodeURIComponent(ref)}`);
        if (isStaged) queryParams.push('staged=1');
        if (requestedLine) queryParams.push(`line=${requestedLine}`);
        if (requestedColumn) queryParams.push(`column=${requestedColumn}`);
        if (machineFileReaderId) queryParams.push(`machineId=${encodeURIComponent(machineFileReaderId)}`);
        return `${stripTrailingSlash(getShareOrigin())}/session/${encodeURIComponent(sessionId!)}/file?${queryParams.join('&')}`;
    }, [displayMode, encodedPath, filePath, isStaged, machineFileReaderId, preferredView, ref, requestedColumn, requestedLine, sessionId]);

    const handleShare = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(buildShareLink());
            hapticsLight();
            showCopiedToast();
        } catch (shareError) {
            console.error('Failed to copy share link:', shareError);
            Modal.alert(t('common.error'), 'Failed to copy link');
        }
    }, [buildShareLink]);

    // Menu items
    const menuItems: ActionMenuItem[] = React.useMemo(() => {
        const items: ActionMenuItem[] = [
            {
                label: t('files.copyRelativePath'),
                onPress: async () => {
                    await Clipboard.setStringAsync(relativePath);
                    hapticsLight(); showCopiedToast();
                },
            },
            {
                label: t('files.copyFileName'),
                onPress: async () => {
                    await Clipboard.setStringAsync(fileName);
                    hapticsLight(); showCopiedToast();
                },
            },
            {
                label: t('files.share'),
                onPress: handleShare,
            },
        ];

        // History: only for non-ref views (viewing current file, not a specific commit)
        if (!ref && !canReadFromMachine && (gitCwd || sessionPath)) {
            items.push({
                label: t('files.fileHistory'),
                onPress: () => {
                    router.push(`/session/${sessionId}/commits?file=${encodeURIComponent(relativePath)}`);
                },
            });
        }

        // Edit: only for non-ref, non-binary files. In embedded mode, swap to
        // inline EditScreen instead of pushing /edit (keeps chat column visible).
        if (!ref && fileContent && !fileContent.isBinary && !isPreviewImageFile) {
            items.push({
                label: t('files.editFile'),
                onPress: () => {
                    if (props?.embedded) {
                        setEditMode(true);
                        return;
                    }
                    const encodedPath = btoa(
                        new TextEncoder().encode(filePath).reduce((s, b) => s + String.fromCharCode(b), '')
                    );
                    router.push(`/session/${sessionId}/edit?path=${encodeURIComponent(encodedPath)}`);
                },
            });
        }

        // Download/share original bytes. Web uses a Blob download; native writes a
        // temporary cache file and opens the platform share/save sheet.
        if (!ref && sessionId) {
            items.push({
                label: t('files.downloadFile'),
                onPress: handleDownload,
            });
        }

        // Delete: only for non-ref views
        if (!ref && !canReadFromMachine && (gitCwd || sessionPath)) {
            items.push({
                label: t('files.deleteFile'),
                destructive: true,
                onPress: async () => {
                    const confirmed = await Modal.confirm(
                        t('files.deleteFile'),
                        t('files.deleteFileConfirm', { fileName }),
                        { destructive: true },
                    );
                    if (!confirmed) return;
                    const escapedPath = shellEscape(filePath);
                    const result = await sessionBash(sessionId!, {
                        command: `rm -- ${escapedPath}`,
                        cwd: gitCwd || sessionPath,
                        timeout: 5000,
                    });
                    if (result.success) {
                        Modal.alert(t('common.success'), t('files.deleteFileSuccess'));
                        router.back();
                    } else {
                        Modal.alert(t('common.error'), t('files.deleteFileFailed'));
                    }
                },
            });
        }

        return items;
    }, [relativePath, fileName, fileContent, ref, sessionPath, gitCwd, sessionId, filePath, router, isPreviewImageFile, handleShare, handleDownload, canReadFromMachine]);

    // Determine file language from extension
    const getFileLanguage = React.useCallback((path: string): string | null => {
        const ext = path.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js':
            case 'jsx':
                return 'javascript';
            case 'ts':
            case 'tsx':
                return 'typescript';
            case 'py':
                return 'python';
            case 'html':
            case 'htm':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'json';
            case 'md':
                return 'markdown';
            case 'xml':
                return 'xml';
            case 'yaml':
            case 'yml':
                return 'yaml';
            case 'sh':
            case 'bash':
                return 'bash';
            case 'sql':
                return 'sql';
            case 'go':
                return 'go';
            case 'rust':
            case 'rs':
                return 'rust';
            case 'java':
                return 'java';
            case 'c':
                return 'c';
            case 'cpp':
            case 'cc':
            case 'cxx':
                return 'cpp';
            case 'php':
                return 'php';
            case 'rb':
                return 'ruby';
            case 'swift':
                return 'swift';
            case 'kt':
                return 'kotlin';
            default:
                return null;
        }
    }, []);

    // Check if file is likely binary based on extension
    const isBinaryFile = React.useCallback((path: string): boolean => {
        const ext = path.split('.').pop()?.toLowerCase();
        const binaryExtensions = [
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'ico',
            'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm',
            'mp3', 'wav', 'flac', 'aac', 'ogg',
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
            'zip', 'tar', 'gz', 'rar', '7z',
            'exe', 'dmg', 'deb', 'rpm',
            'woff', 'woff2', 'ttf', 'otf',
            'db', 'sqlite', 'sqlite3'
        ];
        return ext ? binaryExtensions.includes(ext) : false;
    }, []);

    // Load file content
    React.useEffect(() => {
        let isCancelled = false;

        const loadFile = async () => {
            try {
                setIsLoading(true);
                setError(null);
                setFileContent(null);
                setDiffContent(null);
                setImageBase64(null);
                setVideoBase64(null);
                setImageViewerVisible(false);

                // Get session metadata for git commands
                const session = getSession(sessionId!);
                const sessionPath = session?.metadata?.path;

                if (isPreviewImageFile && !ref) {
                    const response = canReadFromMachine
                        ? await machineReadFile(machineFileReaderId!, filePath)
                        : await sessionReadFile(sessionId!, filePath);
                    if (!isCancelled) {
                        if (response && response.success && response.content) {
                            const mimeType = getImageMimeType(filePath) || 'image/png';
                            setFileContent({
                                content: '',
                                encoding: 'base64',
                                isBinary: false,
                            });
                            setImageBase64(response.content);
                            setImageMimeType(mimeType);
                        } else {
                            setError(response?.error || 'Failed to read file');
                        }
                    }
                    return;
                }


                if (isPreviewVideoFile && !ref) {
                    const response = canReadFromMachine
                        ? await machineReadFile(machineFileReaderId!, filePath)
                        : await sessionReadFile(sessionId!, filePath);
                    if (!isCancelled) {
                        if (response && response.success && response.content) {
                            const mimeType = getVideoMimeType(filePath) || 'video/mp4';
                            setFileContent({
                                content: '',
                                encoding: 'base64',
                                isBinary: false,
                            });
                            setVideoBase64(response.content);
                            setVideoMimeType(mimeType);
                        } else {
                            setError(response?.error || 'Failed to read file');
                        }
                    }
                    return;
                }

                // Check if file is likely binary before trying to read
                if (isBinaryFile(filePath)) {
                    if (!isCancelled) {
                        setFileContent({
                            content: '',
                            encoding: 'base64',
                            isBinary: true
                        });
                        setIsLoading(false);
                    }
                    return;
                }

                // Fetch git diff for the file
                // Use repo-specific cwd for multi-repo workspaces
                const effectiveCwd = gitCwd || sessionPath;
                if (!canReadFromMachine && effectiveCwd && sessionId) {
                    try {
                        const repoRelativePath = getRepoRelativePath(filePath, effectiveCwd);
                        const escapedPath = shellEscape(repoRelativePath);
                        const diffCommand = ref
                            ? `git diff --no-ext-diff ${shellEscape(`${ref}~1`)} ${shellEscape(ref)} -- ${escapedPath}`
                            : isStaged
                                ? `git diff --cached --no-ext-diff -- ${escapedPath}`
                                : `git diff --no-ext-diff -- ${escapedPath}`;
                        const diffResponse = await sessionBash(sessionId, {
                            command: diffCommand,
                            cwd: effectiveCwd,
                            timeout: 5000
                        });

                        if (!isCancelled && diffResponse.success && diffResponse.stdout.trim()) {
                            setDiffContent(diffResponse.stdout);
                        }
                    } catch (diffError) {
                        console.log('Could not fetch git diff:', diffError);
                    }
                }

                if (ref && effectiveCwd && sessionId) {
                    // For a specific commit ref, use git show to get file content at that revision
                    const relativePath = getRepoRelativePath(filePath, effectiveCwd);
                    const escapedShowTarget = shellEscape(`${ref}:${relativePath}`);
                    const showResponse = await sessionBash(sessionId, {
                        command: `git show ${escapedShowTarget}`,
                        cwd: effectiveCwd,
                        timeout: 10000,
                    });

                    if (!isCancelled) {
                        if (showResponse.success) {
                            setFileContent({
                                content: showResponse.stdout || '',
                                encoding: 'utf8',
                                isBinary: false,
                            });
                        } else {
                            // File may have been deleted in this commit; show diff only
                            setFileContent({ content: '', encoding: 'utf8', isBinary: false });
                        }
                    }
                } else {
                    const response = canReadFromMachine
                        ? await machineReadFile(machineFileReaderId!, filePath)
                        : await sessionReadFile(sessionId, filePath);

                    if (!isCancelled) {
                        if (response && response.success && response.content) {
                            // Decode base64 content to UTF-8 string
                            let decodedContent: string;
                            try {
                                const binaryString = atob(response.content);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                decodedContent = new TextDecoder('utf-8').decode(bytes);
                            } catch (decodeError) {
                                // If base64 decode fails, treat as binary
                                setFileContent({
                                    content: '',
                                    encoding: 'base64',
                                    isBinary: true
                                });
                                return;
                            }

                            // Check if content contains binary data (null bytes or too many non-printable chars)
                            const hasNullBytes = decodedContent.includes('\0');
                            const nonPrintableCount = decodedContent.split('').filter(char => {
                                const code = char.charCodeAt(0);
                                return code < 32 && code !== 9 && code !== 10 && code !== 13; // Allow tab, LF, CR
                            }).length;
                            const isBinary = hasNullBytes || (nonPrintableCount / decodedContent.length > 0.1);

                            setFileContent({
                                content: isBinary ? '' : decodedContent,
                                encoding: 'utf8',
                                isBinary
                            });
                        } else {
                            setError(response?.error || 'Failed to read file');
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load file:', error);
                if (!isCancelled) {
                    setError('Failed to load file');
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadFile();

        return () => {
            isCancelled = true;
        };
    }, [sessionId, filePath, ref, isStaged, isBinaryFile, isPreviewImageFile, isPreviewVideoFile, canReadFromMachine, machineFileReaderId, gitCwd]);

    // Show error modal if there's an error
    React.useEffect(() => {
        if (error) {
            Modal.alert(t('common.error'), error);
        }
    }, [error]);

    // Set default display mode based on diff availability
    React.useEffect(() => {
        if (preferredView === 'preview' && (isPreviewHtmlFile || isPreviewMarkdownFile) && fileContent && !fileContent.isBinary) {
            setDisplayMode('preview');
        } else if (preferredView === 'file' && fileContent && !fileContent.isBinary) {
            setDisplayMode('file');
        } else if (preferredView === 'diff' && diffContent) {
            setDisplayMode('diff');
        } else if (diffContent && !isPreviewMarkdownFile) {
            setDisplayMode('diff');
        } else if (isPreviewMarkdownFile && fileContent && !fileContent.isBinary) {
            setDisplayMode('preview');
        } else if (isPreviewHtmlFile && fileContent && !fileContent.isBinary) {
            setDisplayMode('preview');
        } else if (diffContent) {
            setDisplayMode('diff');
        } else if (fileContent) {
            setDisplayMode('file');
        }
    }, [diffContent, fileContent, preferredView, isPreviewHtmlFile, isPreviewMarkdownFile]);

    const language = getFileLanguage(filePath);
    const editorLanguage = language || 'plaintext';
    const useReadOnlyCodeEditor = displayMode === 'file' && !!fileContent?.content;
    const useHtmlPreview = displayMode === 'preview' && isPreviewHtmlFile && !!fileContent?.content;
    const useMarkdownPreview = displayMode === 'preview' && isPreviewMarkdownFile && !!fileContent?.content && !fileContent.isBinary;
    const handleReadOnlyEditorChange = React.useCallback(() => {
        // Viewer mode only: ignore edits.
    }, []);

    // Handle long press to open text selection screen
    const handleLongPress = React.useCallback((content: string) => {
        if (Platform.OS === 'web') return;
        try {
            const textId = storeTempText(content);
            router.push(`/text-selection?textId=${textId}`);
        } catch (error) {
            console.error('Error storing text for selection:', error);
            Modal.alert(t('common.error'), 'Failed to open text selection');
        }
    }, [router]);

    // Get current display content for long press
    const currentContent = React.useMemo(() => {
        if (displayMode === 'diff' && diffContent) {
            return diffContent;
        } else if (displayMode === 'file' && fileContent?.content) {
            return fileContent.content;
        }
        return '';
    }, [displayMode, diffContent, fileContent]);

    // Long press gesture for text selection
    const longPressGesture = React.useMemo(() =>
        Gesture.LongPress()
            .minDuration(500)
            .onStart(() => {
                if (currentContent) {
                    handleLongPress(currentContent);
                }
            })
            .runOnJS(true),
        [currentContent, handleLongPress]
    );

    // Wrap every return in DesktopModalShell so PC users see the file viewer
    // as a centered card overlay instead of a full-screen route push. Shell
    // is a no-op (passthrough) on native or width<1024 or when embedded.
    const shellTitle = fileName || t('common.fileViewer');

    if (isLoading) {
        return (
            <DesktopModalShell title={shellTitle} disabled={embedded}>
                <View style={{
                    flex: 1,
                    backgroundColor: theme.colors.surface,
                    justifyContent: 'center',
                    alignItems: 'center'
                }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={{
                        marginTop: 16,
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        ...Typography.default()
                    }}>
                        {t('files.loadingFile', { fileName })}
                    </Text>
                </View>
            </DesktopModalShell>
        );
    }

    if (error) {
        return (
            <DesktopModalShell title={shellTitle} disabled={embedded}>
                <View style={{
                    flex: 1,
                    backgroundColor: theme.colors.surface,
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 20
                }}>
                    <Text style={{
                        fontSize: 18,
                        fontWeight: 'bold',
                        color: theme.colors.textDestructive,
                        marginBottom: 8,
                        ...Typography.default('semiBold')
                    }}>
                        {t('common.error')}
                    </Text>
                    <Text style={{
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        textAlign: 'center',
                        ...Typography.default()
                    }}>
                        {error}
                    </Text>
                </View>
            </DesktopModalShell>
        );
    }

    if (editMode && embedded) {
        return (
            <EditScreen
                sessionId={sessionId}
                encodedPath={encodedPath}
                embedded
                onBack={() => setEditMode(false)}
            />
        );
    }

    return (
    <DesktopModalShell title={shellTitle} disabled={embedded}>
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {!embedded && (
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
            )}
            {embedded && props?.onBack && (
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                }}>
                    <Pressable
                        onPress={props.onBack}
                        hitSlop={10}
                        style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            opacity: pressed ? 0.6 : 1,
                        })}
                    >
                        <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
                        <Text style={{ fontSize: 14, color: theme.colors.text }}>{fileName || 'Back'}</Text>
                    </Pressable>
                    <View style={{ flex: 1 }} />
                    <View ref={menuTriggerRef}>
                        <Pressable
                            onPress={() => setMenuVisible(true)}
                            hitSlop={10}
                            style={{ paddingHorizontal: 6 }}
                        >
                            <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                </View>
            )}
            {useDropdownMenu ? (
                <DropdownMenu
                    anchorRef={menuTriggerRef}
                    visible={menuVisible}
                    items={menuItems}
                    onClose={() => setMenuVisible(false)}
                />
            ) : (
                <ActionMenuModal
                    visible={menuVisible}
                    items={menuItems}
                    onClose={() => setMenuVisible(false)}
                />
            )}

            {/* File path header - single line, scrollable, long press to copy */}
            <View style={{
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surfaceHigh,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
            }}>
                <View style={{ paddingLeft: 16 }}>
                    <FileIcon fileName={fileName} size={20} />
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 8, paddingRight: 16, alignItems: 'center' }}
                    style={{ flex: 1 }}
                >
                    <Pressable
                        onLongPress={async () => {
                            try {
                                await Clipboard.setStringAsync(filePath);
                                hapticsLight(); showCopiedToast();
                            } catch { /* ignore */ }
                        }}
                    >
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            ...Typography.mono(),
                        }} numberOfLines={1}>
                            {displayPath}
                        </Text>
                    </Pressable>
                </ScrollView>
            </View>

            {videoPreviewUri ? (
                <View style={{ flex: 1, padding: 16 }}>
                    <VideoPreview uri={videoPreviewUri} fileName={fileName} />
                </View>
            ) : imagePreviewUri ? (
                <>
                    <View style={{ flex: 1, padding: 16 }}>
                        <Pressable onPress={() => setImageViewerVisible(true)} style={{ flex: 1 }}>
                            <Image
                                source={{ uri: imagePreviewUri }}
                                style={{ width: '100%', height: '100%', borderRadius: 10 }}
                                contentFit="contain"
                            />
                        </Pressable>
                    </View>
                    <ImageViewer
                        images={imageViewerItems}
                        initialIndex={0}
                        visible={imageViewerVisible}
                        onClose={() => setImageViewerVisible(false)}
                    />
                </>
            ) : (
                <>
                    {/* Toggle buttons for File/Diff view */}
                    {(diffContent || isPreviewHtmlFile || isPreviewMarkdownFile) && (
                        <View style={{
                            flexDirection: 'row',
                            paddingHorizontal: 16,
                            paddingVertical: 12,
                            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                            borderBottomColor: theme.colors.divider,
                            backgroundColor: theme.colors.surface
                        }}>
                            {diffContent && !isPreviewMarkdownFile && (
                                <Pressable
                                    onPress={() => setDisplayMode('diff')}
                                    style={{
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 8,
                                        backgroundColor: displayMode === 'diff' ? theme.colors.textLink : theme.colors.input.background,
                                        marginRight: 8
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: displayMode === 'diff' ? 'white' : theme.colors.textSecondary,
                                        ...Typography.default()
                                    }}>
                                        {t('files.diff')}
                                    </Text>
                                </Pressable>
                            )}

                            {(isPreviewHtmlFile || isPreviewMarkdownFile) && (
                                <Pressable
                                    onPress={() => setDisplayMode('preview')}
                                    style={{
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 8,
                                        backgroundColor: displayMode === 'preview' ? theme.colors.textLink : theme.colors.input.background,
                                        marginRight: 8
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: displayMode === 'preview' ? 'white' : theme.colors.textSecondary,
                                        ...Typography.default()
                                    }}>
                                        {t('machineEdit.previewMode')}
                                    </Text>
                                </Pressable>
                            )}

                            <Pressable
                                onPress={() => setDisplayMode('file')}
                                style={{
                                    paddingHorizontal: 16,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                    backgroundColor: displayMode === 'file' ? theme.colors.textLink : theme.colors.input.background
                                }}
                            >
                                <Text style={{
                                    fontSize: 14,
                                    fontWeight: '600',
                                    color: displayMode === 'file' ? 'white' : theme.colors.textSecondary,
                                    ...Typography.default()
                                }}>
                                    {t('files.file')}
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Content display */}
                    {fileContent?.isBinary && !isPreviewVideoFile ? (
                        <View style={{
                            flex: 1,
                            justifyContent: 'center',
                            alignItems: 'center',
                            padding: 20,
                        }}>
                            <Text style={{
                                fontSize: 18,
                                fontWeight: 'bold',
                                color: theme.colors.textSecondary,
                                marginBottom: 8,
                                ...Typography.default('semiBold')
                            }}>
                                {t('files.binaryFile')}
                            </Text>
                            <Text style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                textAlign: 'center',
                                ...Typography.default()
                            }}>
                                {t('files.cannotDisplayBinary')}
                            </Text>
                            <Text style={{
                                fontSize: 14,
                                color: '#999',
                                textAlign: 'center',
                                marginTop: 8,
                                ...Typography.default()
                            }}>
                                {fileName}
                            </Text>
                            {!ref && sessionId ? (
                                <Pressable
                                    onPress={handleDownload}
                                    style={({ pressed }) => ({
                                        marginTop: 20,
                                        paddingHorizontal: 18,
                                        paddingVertical: 10,
                                        borderRadius: 999,
                                        backgroundColor: theme.colors.textLink,
                                        opacity: pressed ? 0.7 : 1,
                                    })}
                                >
                                    <Text style={{
                                        color: 'white',
                                        fontSize: 16,
                                        fontWeight: '600',
                                        ...Typography.default('semiBold'),
                                    }}>
                                        {t('files.downloadFile')}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : useHtmlPreview ? (
                        <HtmlPreview html={fileContent?.content || ''} fileName={fileName} />
                    ) : useMarkdownPreview ? (
                        <ScrollView
                            style={{ flex: 1 }}
                            contentContainerStyle={{ padding: 16 }}
                            showsVerticalScrollIndicator={true}
                        >
                            <MarkdownView markdown={fileContent?.content || ''} />
                        </ScrollView>
                    ) : useReadOnlyCodeEditor ? (
                        <View style={{ flex: 1 }}>
                            <CodeEditor
                                value={fileContent?.content || ''}
                                onChangeText={handleReadOnlyEditorChange}
                                language={editorLanguage}
                                bottomPadding={12}
                                readOnly
                                revealLine={requestedLine}
                                revealColumn={requestedColumn}
                            />
                        </View>
                    ) : (
                        <ScrollView
                            style={{ flex: 1 }}
                            contentContainerStyle={wordWrap ? { padding: 16 } : { paddingVertical: 16 }}
                            showsVerticalScrollIndicator={true}
                        >
                            <ScrollView
                                horizontal={!wordWrap}
                                scrollEnabled={!wordWrap}
                                showsHorizontalScrollIndicator={!wordWrap}
                                contentContainerStyle={wordWrap ? undefined : { paddingHorizontal: 16 }}
                            >
                                {Platform.OS !== 'web' && currentContent ? (
                                    <GestureDetector gesture={longPressGesture}>
                                        <View>
                                            {displayMode === 'diff' && diffContent ? (
                                                <DiffDisplay diffContent={diffContent} />
                                            ) : displayMode === 'file' && fileContent?.content ? (
                                                <SimpleSyntaxHighlighter
                                                    code={fileContent.content}
                                                    language={language}
                                                    selectable={false}
                                                />
                                            ) : displayMode === 'file' && fileContent && !fileContent.content ? (
                                                <Text style={{
                                                    fontSize: 16,
                                                    color: theme.colors.textSecondary,
                                                    fontStyle: 'italic',
                                                    ...Typography.default()
                                                }}>
                                                    {t('files.fileEmpty')}
                                                </Text>
                                            ) : null}
                                        </View>
                                    </GestureDetector>
                                ) : (
                                    <>
                                        {displayMode === 'diff' && diffContent ? (
                                            <DiffDisplay diffContent={diffContent} />
                                        ) : displayMode === 'file' && fileContent?.content ? (
                                            <SimpleSyntaxHighlighter
                                                code={fileContent.content}
                                                language={language}
                                                selectable={true}
                                            />
                                        ) : displayMode === 'file' && fileContent && !fileContent.content ? (
                                            <Text style={{
                                                fontSize: 16,
                                                color: theme.colors.textSecondary,
                                                fontStyle: 'italic',
                                                ...Typography.default()
                                            }}>
                                                {t('files.fileEmpty')}
                                            </Text>
                                        ) : !diffContent && !fileContent?.content ? (
                                            <Text style={{
                                                fontSize: 16,
                                                color: theme.colors.textSecondary,
                                                fontStyle: 'italic',
                                                ...Typography.default()
                                            }}>
                                                {t('files.noChanges')}
                                            </Text>
                                        ) : null}
                                    </>
                                )}
                            </ScrollView>
                        </ScrollView>
                    )}
                </>
            )}
        </View>
    </DesktopModalShell>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    htmlPreviewContainer: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    htmlPreviewWebView: {
        flex: 1,
    },
    videoPreviewContainer: {
        flex: 1,
        backgroundColor: '#000',
        borderRadius: 10,
        overflow: 'hidden',
    },
    videoPreviewWebView: {
        flex: 1,
        backgroundColor: '#000',
        borderRadius: 10,
        overflow: 'hidden',
    },
}));
