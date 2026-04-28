import * as React from 'react';
import { View, ActivityIndicator, Platform, Pressable, ScrollView, TextInput } from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { sessionListDirectory, sessionBash, sessionReadFile } from '@/sync/ops';
import { Modal } from '@/modal';
import { showToast } from '@/components/Toast';
import { hapticsLight } from '@/components/haptics';
import { getSession } from '@/sync/storage';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { FileIcon } from '@/components/FileIcon';
import { t } from '@/text';
import { loadBrowserLastPath, saveBrowserLastPath } from '@/sync/persistence';
import FileScreen from '@/app/(app)/session/[id]/file';

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

interface SearchResult {
    relativePath: string;
    fileName: string;
    dirPath: string;
}

function formatFileSize(bytes?: number): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseGlobalResults(stdout: string): SearchResult[] {
    return stdout.trim().split('\n').filter(Boolean).slice(0, 100).map(line => {
        const relativePath = line.startsWith('./') ? line.substring(2) : line;
        const fileName = relativePath.split('/').pop() || relativePath;
        const dirPath = relativePath.includes('/')
            ? relativePath.substring(0, relativePath.lastIndexOf('/'))
            : '';
        return { relativePath, fileName, dirPath };
    });
}

export default function BrowserScreen(props?: { sessionId?: string; embedded?: boolean }) {
    const route = useRoute();
    const router = useRouter();
    const sessionId = props?.sessionId ?? ((route.params as any)?.id as string);
    const embedded = props?.embedded ?? false;
    const { theme } = useUnistyles();

    const session = getSession(sessionId);
    const rootPath = session?.metadata?.path || '';

    const [currentPath, setCurrentPath] = React.useState(rootPath);
    const [entries, setEntries] = React.useState<DirectoryEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    // Embedded mode (right panel): swap content to FileScreen in-place
    // when a file is tapped, instead of pushing the full /file route.
    const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
    // Multi-select / compress-download state. selectedNames are entry names
    // within `currentPath`; reset when navigating directories or exiting mode.
    const [selectMode, setSelectMode] = React.useState(false);
    const [selectedNames, setSelectedNames] = React.useState<Set<string>>(() => new Set());
    const [downloading, setDownloading] = React.useState(false);
    React.useEffect(() => {
        // Reset selection when changing directory or exiting select mode.
        setSelectedNames(new Set());
    }, [currentPath, selectMode]);

    // Search state
    const [searchActive, setSearchActive] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [globalResults, setGlobalResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const searchInputRef = React.useRef<TextInput>(null);

    const loadDirectory = React.useCallback(async (path: string, silent?: boolean): Promise<boolean> => {
        if (!silent) setIsLoading(true);
        setError(null);
        try {
            const response = await sessionListDirectory(sessionId, path);
            if (response.success && response.entries) {
                setEntries(response.entries);
                setCurrentPath(path);
                if (rootPath && path.startsWith(rootPath)) {
                    saveBrowserLastPath(rootPath, path);
                }
                return true;
            } else {
                setError(response.error || t('browser.failedToLoad'));
                return false;
            }
        } catch (e) {
            setError(t('browser.failedToLoad'));
            return false;
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [sessionId, rootPath]);

    React.useEffect(() => {
        let cancelled = false;

        const loadInitialDirectory = async () => {
            if (!rootPath) return;

            const cachedPath = loadBrowserLastPath(rootPath);
            const initialPath = cachedPath && cachedPath.startsWith(rootPath) ? cachedPath : rootPath;
            const ok = await loadDirectory(initialPath);
            if (!ok && !cancelled && initialPath !== rootPath) {
                await loadDirectory(rootPath);
            }
        };

        loadInitialDirectory();

        return () => {
            cancelled = true;
        };
    }, [rootPath, loadDirectory]);

    // Refresh silently when screen is focused (after returning from file view)
    useFocusEffect(
        React.useCallback(() => {
            if (entries.length > 0) {
                loadDirectory(currentPath, true);
            }
        }, [entries.length, currentPath, loadDirectory])
    );

    // Global file search with debounce
    React.useEffect(() => {
        if (!searchQuery || searchQuery.length < 2 || !rootPath) {
            setGlobalResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        const timer = setTimeout(async () => {
            try {
                const response = await sessionBash(sessionId, {
                    command: `find . -type f -iname "*${searchQuery.replace(/"/g, '')}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`,
                    cwd: rootPath,
                    timeout: 10000,
                });
                if (response.success && response.stdout) {
                    setGlobalResults(parseGlobalResults(response.stdout));
                } else {
                    setGlobalResults([]);
                }
            } catch {
                setGlobalResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery, sessionId, rootPath]);

    const navigateTo = React.useCallback((path: string) => {
        loadDirectory(path);
    }, [loadDirectory]);

    const handleEntryPress = React.useCallback((entry: DirectoryEntry) => {
        // In select mode, row tap toggles selection — chevron-press still navigates.
        if (selectMode) {
            setSelectedNames(prev => {
                const next = new Set(prev);
                if (next.has(entry.name)) next.delete(entry.name);
                else next.add(entry.name);
                return next;
            });
            return;
        }
        const fullPath = `${currentPath}/${entry.name}`;
        if (entry.type === 'directory') {
            navigateTo(fullPath);
        } else {
            const encodedPath = btoa(
                new TextEncoder().encode(fullPath).reduce((s, b) => s + String.fromCharCode(b), '')
            );
            if (embedded) {
                setSelectedFilePath(encodedPath);
            } else {
                router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}`);
            }
        }
    }, [currentPath, navigateTo, router, sessionId, embedded, selectMode]);

    const handleSelectAll = React.useCallback(() => {
        setSelectedNames(new Set(entries.map(e => e.name)));
    }, [entries]);

    const handleInvertSelection = React.useCallback(() => {
        setSelectedNames(prev => {
            const next = new Set<string>();
            for (const e of entries) if (!prev.has(e.name)) next.add(e.name);
            return next;
        });
    }, [entries]);

    const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

    const handleCompressDownload = React.useCallback(async () => {
        if (!sessionId || selectedNames.size === 0 || downloading) return;
        const names = Array.from(selectedNames);
        const cwd = currentPath;
        const ts = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
        const tmpZip = `/tmp/happy-download-${stamp}.zip`;
        const downloadName = `download-${stamp}.zip`;

        setDownloading(true);
        try {
            // 1. Estimate total size with du -sh for warning gate.
            const duArgs = names.map(shellQuote).join(' ');
            const duRes = await sessionBash(sessionId, {
                command: `du -sk -- ${duArgs} | awk '{s+=$1} END {print s}'`,
                cwd,
                timeout: 15000,
            });
            const sizeKb = parseInt((duRes.stdout || '0').trim(), 10) || 0;
            const sizeMb = sizeKb / 1024;
            if (sizeMb > 100) {
                const ok = await Modal.confirm(
                    t('browser.compressDownload'),
                    t('browser.compressLargeWarning', { sizeMb: sizeMb.toFixed(1) }),
                );
                if (!ok) { setDownloading(false); return; }
            }

            // 2. Zip into /tmp. -r recursive, -q quiet, -X strip extra attrs.
            const zipArgs = names.map(shellQuote).join(' ');
            const zipRes = await sessionBash(sessionId, {
                command: `zip -rqX -- ${shellQuote(tmpZip)} ${zipArgs}`,
                cwd,
                timeout: 600000,
            });
            if (!zipRes.success) {
                Modal.alert(t('common.error'), zipRes.stderr || t('browser.compressFailed'));
                return;
            }

            // 3. Read zip back, decode base64, trigger download.
            const readRes = await sessionReadFile(sessionId, tmpZip);
            if (!readRes.success || !readRes.content) {
                Modal.alert(t('common.error'), readRes.error || t('browser.compressFailed'));
                return;
            }
            if (Platform.OS === 'web') {
                const binary = atob(readRes.content);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = downloadName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                hapticsLight();
                showToast(t('browser.downloadStarted'));
            }

            // 4. Cleanup tmp file (best effort).
            await sessionBash(sessionId, {
                command: `rm -f -- ${shellQuote(tmpZip)}`,
                cwd: '/tmp',
                timeout: 5000,
            }).catch(() => {});

            setSelectMode(false);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('browser.compressFailed'));
        } finally {
            setDownloading(false);
        }
    }, [sessionId, selectedNames, currentPath, downloading]);

    const handleSearchResultPress = React.useCallback((result: SearchResult) => {
        const fullPath = `${rootPath}/${result.relativePath}`;
        const encodedPath = btoa(
            new TextEncoder().encode(fullPath).reduce((s, b) => s + String.fromCharCode(b), '')
        );
        if (embedded) {
            setSelectedFilePath(encodedPath);
        } else {
            router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}`);
        }
    }, [rootPath, router, sessionId, embedded]);

    const handleNavigateUp = React.useCallback(() => {
        if (currentPath === rootPath) return;
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || rootPath;
        navigateTo(parentPath);
    }, [currentPath, rootPath, navigateTo]);

    const toggleSearch = React.useCallback(() => {
        if (searchActive) {
            setSearchActive(false);
            setSearchQuery('');
            setGlobalResults([]);
        } else {
            setSearchActive(true);
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [searchActive]);

    // Filter current directory entries by search query
    const filteredEntries = React.useMemo(() => {
        if (!searchQuery) return entries;
        const q = searchQuery.toLowerCase();
        return entries.filter(e => e.name.toLowerCase().includes(q));
    }, [entries, searchQuery]);

    // Breadcrumb segments
    const breadcrumbs = React.useMemo(() => {
        if (!rootPath || !currentPath.startsWith(rootPath)) return [];
        const relativePath = currentPath.substring(rootPath.length);
        const projectName = rootPath.split('/').pop() || rootPath;
        const segments: { label: string; path: string }[] = [
            { label: projectName, path: rootPath },
        ];
        if (relativePath) {
            const parts = relativePath.split('/').filter(Boolean);
            let accumulated = rootPath;
            for (const part of parts) {
                accumulated += '/' + part;
                segments.push({ label: part, path: accumulated });
            }
        }
        return segments;
    }, [currentPath, rootPath]);

    const isAtRoot = currentPath === rootPath;
    const breadcrumbRef = React.useRef<ScrollView>(null);

    // Auto-scroll breadcrumb to end when path changes
    React.useEffect(() => {
        setTimeout(() => {
            breadcrumbRef.current?.scrollToEnd({ animated: true });
        }, 50);
    }, [currentPath]);

    if (embedded && selectedFilePath) {
        return (
            <FileScreen
                sessionId={sessionId}
                encodedPath={selectedFilePath}
                embedded
                onBack={() => setSelectedFilePath(null)}
            />
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {!embedded && (
                <Stack.Screen
                    options={{
                        headerRight: () => (
                            <Pressable
                                onPress={toggleSearch}
                                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                            >
                                <Ionicons
                                    name={searchActive ? 'close' : 'search'}
                                    size={22}
                                    color={theme.colors.header.tint}
                                />
                            </Pressable>
                        ),
                    }}
                />
            )}

            {/* Search bar */}
            {searchActive && (
                <View style={{
                    padding: 12,
                    paddingTop: 8,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                    }}>
                        <Ionicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            ref={searchInputRef}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder={t('browser.searchPlaceholder')}
                            style={{
                                flex: 1,
                                fontSize: 16,
                                color: theme.colors.text,
                                ...Typography.default(),
                            }}
                            placeholderTextColor={theme.colors.input.placeholder}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                        />
                        {searchQuery.length > 0 && (
                            <Pressable onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>
                </View>
            )}

            {/* Breadcrumb navigation row — hidden during search. Wrapped in
                a flex row so the right-side select / select-mode toolbar can
                sit aligned with the breadcrumb scroll. */}
            {!searchActive && (
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surfaceHigh,
            }}>
                <ScrollView
                    ref={breadcrumbRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{
                        flexGrow: 1,
                        flexShrink: 1,
                    }}
                    contentContainerStyle={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        alignItems: 'center',
                    }}
                >
                    {breadcrumbs.map((segment, index) => (
                        <React.Fragment key={segment.path}>
                            {index > 0 && (
                                <Ionicons
                                    name="chevron-forward"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                    style={{ marginHorizontal: 4 }}
                                />
                            )}
                            <Pressable onPress={() => navigateTo(segment.path)}>
                                <Text style={{
                                    fontSize: 14,
                                    color: index === breadcrumbs.length - 1
                                        ? theme.colors.text
                                        : theme.colors.textLink,
                                    fontWeight: index === breadcrumbs.length - 1 ? '600' : '400',
                                    ...Typography.default(),
                                }}>
                                    {segment.label}
                                </Text>
                            </Pressable>
                        </React.Fragment>
                    ))}
                </ScrollView>
                {/* Right-side action: enter select mode (or 全选/反选/取消 inside select mode). */}
                {!selectMode ? (
                    <Pressable
                        onPress={() => setSelectMode(true)}
                        hitSlop={10}
                        style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            opacity: pressed ? 0.5 : 1,
                        })}
                        accessibilityLabel={t('browser.select')}
                    >
                        <Ionicons name="checkmark-done-outline" size={18} color={theme.colors.textLink} />
                    </Pressable>
                ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
                        <Pressable onPress={handleSelectAll} hitSlop={10} style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 12, opacity: pressed ? 0.5 : 1 })}>
                            <Text style={{ fontSize: 13, color: theme.colors.textLink, ...Typography.default('semiBold') }}>{t('browser.selectAll')}</Text>
                        </Pressable>
                        <Pressable onPress={handleInvertSelection} hitSlop={10} style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 12, opacity: pressed ? 0.5 : 1 })}>
                            <Text style={{ fontSize: 13, color: theme.colors.textLink, ...Typography.default('semiBold') }}>{t('browser.invertSelection')}</Text>
                        </Pressable>
                        <Pressable onPress={() => setSelectMode(false)} hitSlop={10} style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 12, opacity: pressed ? 0.5 : 1 })}>
                            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>{t('common.cancel')}</Text>
                        </Pressable>
                    </View>
                )}
            </View>
            )}

            {/* Directory listing / Search results */}
            <ItemList style={{ flex: 1 }}>
                {isLoading ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 }}>
                        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 16, ...Typography.default() }}>
                            {error}
                        </Text>
                    </View>
                ) : searchActive && searchQuery.length > 0 ? (
                    <>
                        {/* Local filtered results */}
                        {filteredEntries.length > 0 && filteredEntries.map((entry, index) => (
                            <Item
                                key={entry.name}
                                title={entry.name}
                                subtitle={entry.type === 'file' ? formatFileSize(entry.size) : undefined}
                                icon={entry.type === 'directory'
                                    ? <Ionicons name="folder" size={29} color="#007AFF" />
                                    : <FileIcon fileName={entry.name} size={29} />
                                }
                                onPress={() => handleEntryPress(entry)}
                                showDivider={index < filteredEntries.length - 1 || globalResults.length > 0}
                                showChevron={entry.type === 'directory'}
                            />
                        ))}

                        {/* Global search results section */}
                        {searchQuery.length >= 2 && (
                            <>
                                {isSearching ? (
                                    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    </View>
                                ) : globalResults.length > 0 ? (
                                    <>
                                        <View style={{
                                            paddingHorizontal: 16,
                                            paddingTop: 16,
                                            paddingBottom: 8,
                                        }}>
                                            <Text style={{
                                                fontSize: 13,
                                                color: theme.colors.textSecondary,
                                                textTransform: 'uppercase',
                                                letterSpacing: 0.5,
                                                ...Typography.default('semiBold'),
                                            }}>
                                                {t('browser.globalResults')}
                                            </Text>
                                        </View>
                                        {globalResults.map((result, index) => (
                                            <Item
                                                key={result.relativePath}
                                                title={result.fileName}
                                                subtitle={result.dirPath}
                                                icon={<FileIcon fileName={result.fileName} size={29} />}
                                                onPress={() => handleSearchResultPress(result)}
                                                showDivider={index < globalResults.length - 1}
                                            />
                                        ))}
                                    </>
                                ) : null}
                            </>
                        )}

                        {/* No results at all */}
                        {filteredEntries.length === 0 && globalResults.length === 0 && !isSearching && (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 }}>
                                <Ionicons name="search-outline" size={48} color={theme.colors.textSecondary} />
                                <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 16, ...Typography.default() }}>
                                    {t('browser.noResults')}
                                </Text>
                            </View>
                        )}
                    </>
                ) : entries.length === 0 ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 }}>
                        <Ionicons name="folder-open-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 16, ...Typography.default() }}>
                            {t('browser.emptyDirectory')}
                        </Text>
                    </View>
                ) : (
                    <>
                        {/* Parent directory entry */}
                        {!isAtRoot && (
                            <Item
                                title=""
                                icon={<Text style={{ fontSize: 22, color: theme.colors.textSecondary, fontWeight: '800', width: 29, textAlign: 'center' }}>..</Text>}
                                onPress={handleNavigateUp}
                                showDivider={entries.length > 0}
                            />
                        )}

                        {/* Directory and file entries */}
                        {entries.map((entry, index) => {
                            const checked = selectedNames.has(entry.name);
                            const baseIcon = entry.type === 'directory'
                                ? <Ionicons name="folder" size={29} color="#007AFF" />
                                : <FileIcon fileName={entry.name} size={29} />;
                            const icon = selectMode ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Ionicons
                                        name={checked ? 'checkbox' : 'square-outline'}
                                        size={22}
                                        color={checked ? theme.colors.button.primary.background : theme.colors.textSecondary}
                                    />
                                    {baseIcon}
                                </View>
                            ) : baseIcon;
                            return (
                                <Item
                                    key={entry.name}
                                    title={entry.name}
                                    subtitle={entry.type === 'file' ? formatFileSize(entry.size) : undefined}
                                    icon={icon}
                                    onPress={() => handleEntryPress(entry)}
                                    showDivider={index < entries.length - 1}
                                    showChevron={!selectMode && entry.type === 'directory'}
                                />
                            );
                        })}
                    </>
                )}
            </ItemList>

            {/* Bottom action bar in select mode: 压缩下载 (N) */}
            {selectMode && (
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderTopWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderTopColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                }}>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('browser.selectedCount', { count: selectedNames.size })}
                    </Text>
                    <Pressable
                        onPress={handleCompressDownload}
                        disabled={selectedNames.size === 0 || downloading}
                        style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: selectedNames.size === 0 || downloading
                                ? theme.colors.surfacePressed
                                : theme.colors.button.primary.background,
                            opacity: pressed ? 0.7 : 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                        })}
                    >
                        {downloading && <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />}
                        <Text style={{
                            fontSize: 13,
                            color: selectedNames.size === 0 || downloading
                                ? theme.colors.textSecondary
                                : theme.colors.button.primary.tint,
                            ...Typography.default('semiBold'),
                        }}>
                            {downloading ? t('browser.compressing') : t('browser.compressDownload')}
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create((_theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center' as const,
        width: '100%',
    },
}));
