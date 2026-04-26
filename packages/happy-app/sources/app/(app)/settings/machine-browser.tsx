import * as React from 'react';
import { View, ActivityIndicator, Platform, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { machineListDirectory, machineWriteFile } from '@/sync/ops';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { FileIcon } from '@/components/FileIcon';
import { Modal } from '@/modal';
import { t } from '@/text';

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

function formatFileSize(bytes?: number): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Lightweight file browser for machine-scoped paths (e.g. ~/.claude/).
 * Mirrors BrowserScreen but uses machine RPCs instead of session ones, and
 * navigates files into machine-edit instead of the session-scoped editor.
 */
export default function MachineBrowserScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const searchParams = useLocalSearchParams();
    const machineId = searchParams.machineId as string;
    const initialPath = searchParams.path ? decodeURIComponent(searchParams.path as string) : '';

    const [rootPath] = React.useState(initialPath);
    const [currentPath, setCurrentPath] = React.useState(initialPath);
    const [entries, setEntries] = React.useState<DirectoryEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const loadDirectory = React.useCallback(async (path: string, silent?: boolean) => {
        if (!silent) setIsLoading(true);
        setError(null);
        try {
            const response = await machineListDirectory(machineId, path);
            if (response.success && response.entries) {
                const sorted = [...response.entries].sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                setEntries(sorted);
                setCurrentPath(path);
            } else {
                setError(response.error || t('browser.failedToLoad'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('browser.failedToLoad'));
        } finally {
            setIsLoading(false);
        }
    }, [machineId]);

    React.useEffect(() => {
        if (machineId && initialPath) {
            void loadDirectory(initialPath);
        }
    }, [machineId, initialPath, loadDirectory]);

    const handleEntryPress = React.useCallback((entry: DirectoryEntry) => {
        const fullPath = currentPath.endsWith('/') ? `${currentPath}${entry.name}` : `${currentPath}/${entry.name}`;
        if (entry.type === 'directory') {
            void loadDirectory(fullPath);
            return;
        }
        if (entry.type === 'file') {
            const encodedPath = encodeURIComponent(fullPath);
            const language = fullPath.toLowerCase().endsWith('.json') ? 'JSON' : (fullPath.toLowerCase().endsWith('.md') ? 'Markdown' : '');
            const validateJson = fullPath.toLowerCase().endsWith('.json') ? '&validateJson=1' : '';
            const langParam = language ? `&language=${language}` : '';
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}${langParam}${validateJson}`);
        }
    }, [currentPath, loadDirectory, router, machineId]);

    const handleNavigateUp = React.useCallback(() => {
        if (currentPath === rootPath) return;
        const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || rootPath;
        if (parent.length < rootPath.length) {
            void loadDirectory(rootPath);
        } else {
            void loadDirectory(parent);
        }
    }, [currentPath, rootPath, loadDirectory]);

    const handleNewFile = React.useCallback(async () => {
        const fileName = await Modal.prompt(
            t('browser.newFileTitle'),
            t('browser.newFilePrompt'),
            { defaultValue: 'untitled.md', confirmText: t('browser.create'), cancelText: t('common.cancel') },
        );
        const trimmed = fileName?.trim();
        if (!trimmed) return;
        if (trimmed.includes('/') || trimmed.includes('\\')) {
            Modal.alert(t('common.error'), t('browser.newFileNameInvalid'));
            return;
        }
        const fullPath = currentPath.endsWith('/') ? `${currentPath}${trimmed}` : `${currentPath}/${trimmed}`;
        try {
            const response = await machineWriteFile(machineId, fullPath, '', null);
            if (!response.success) {
                Modal.alert(t('common.error'), response.error ?? t('browser.newFileFailed'));
                return;
            }
            void loadDirectory(currentPath, true);
            const encodedPath = encodeURIComponent(fullPath);
            router.push(`/settings/machine-edit?machineId=${machineId}&path=${encodedPath}`);
        } catch (err) {
            Modal.alert(t('common.error'), err instanceof Error ? err.message : t('browser.newFileFailed'));
        }
    }, [currentPath, machineId, router, loadDirectory]);

    const breadcrumbs = React.useMemo(() => {
        if (!rootPath || !currentPath.startsWith(rootPath)) return [];
        const relativePath = currentPath.substring(rootPath.length);
        const projectName = rootPath.split('/').pop() || rootPath;
        const segments: { label: string; path: string }[] = [{ label: projectName, path: rootPath }];
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

    const styles = StyleSheet.create((theme) => ({
        container: { flex: 1, backgroundColor: theme.colors.surface },
        breadcrumbBar: {
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 8,
            backgroundColor: theme.colors.surfaceHigh,
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
        },
    }));

    return (
        <View style={[styles.container]}>
            <Stack.Screen
                options={{
                    title: t('claudeConfig.browseTitle'),
                    headerRight: () => (
                        <Pressable onPress={handleNewFile} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Ionicons name="add" size={24} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />
            {breadcrumbs.length > 1 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 12 }}
                    style={styles.breadcrumbBar}
                >
                    {breadcrumbs.map((seg, i) => (
                        <View key={`${seg.path}-${i}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Pressable onPress={() => loadDirectory(seg.path)}>
                                <Text style={{
                                    fontSize: 13,
                                    color: i === breadcrumbs.length - 1 ? theme.colors.text : theme.colors.textSecondary,
                                    ...Typography.default(i === breadcrumbs.length - 1 ? 'semiBold' : undefined),
                                }}>
                                    {seg.label}
                                </Text>
                            </Pressable>
                            {i < breadcrumbs.length - 1 && (
                                <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} style={{ marginHorizontal: 4 }} />
                            )}
                        </View>
                    ))}
                </ScrollView>
            )}

            {isLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            ) : error ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={{ marginTop: 16, fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', ...Typography.default() }}>
                        {error}
                    </Text>
                </View>
            ) : (
                <ItemList style={{ flex: 1, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                    {currentPath !== rootPath && (
                        <Item
                            title=".."
                            icon={<Ionicons name="arrow-up-outline" size={28} color={theme.colors.textSecondary} />}
                            onPress={handleNavigateUp}
                        />
                    )}
                    {entries.map((entry) => (
                        <Item
                            key={entry.name}
                            title={entry.name}
                            subtitle={entry.type === 'file' ? formatFileSize(entry.size) : undefined}
                            icon={entry.type === 'directory'
                                ? <Ionicons name="folder" size={28} color="#1F8FFF" />
                                : <FileIcon fileName={entry.name} size={28} />}
                            onPress={() => handleEntryPress(entry)}
                            showChevron={entry.type === 'directory'}
                        />
                    ))}
                    {entries.length === 0 && currentPath === rootPath && (
                        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                            <Text style={{ fontSize: 14, color: theme.colors.textSecondary, ...Typography.default() }}>
                                {t('browser.emptyDirectory')}
                            </Text>
                        </View>
                    )}
                </ItemList>
            )}
        </View>
    );
}
