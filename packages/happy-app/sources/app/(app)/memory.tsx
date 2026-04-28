import * as React from 'react';
import { View, Pressable, ActivityIndicator, RefreshControl, ScrollView, TextInput, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDesktopRoute, useDrawerHeaderRight } from '@/components/desktopRoutes';
import { setPendingMemoryInjection } from '@/sync/memoryInjection';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, createMemory, updateMemory, deleteMemory, type MemoryRow } from '@/sync/apiMemory';
import { showToast } from '@/components/Toast';
import { hapticsLight } from '@/components/haptics';
import { t } from '@/text';

type GroupKey = 'manual' | 'message-pin';

const GROUP_ORDER: GroupKey[] = ['manual', 'message-pin'];

/**
 * Top-level memory page. Shows the user's stored memories sorted newest-first.
 * Memory rows are injected by happy-cli into Claude's system prompt at session
 * start so anything saved here is available across all future conversations.
 *
 * Two creation paths:
 *   - "+" header button → manual entry via Modal.prompt
 *   - long-press a chat message → "save to memory" action (added separately
 *     in MessageList; this page only owns the list/edit/delete UI)
 */
export default function MemoryScreen() {
    const { theme } = useUnistyles();
    const { isInDrawer } = useDesktopRoute();
    const auth = useAuth();
    const [memories, setMemories] = React.useState<MemoryRow[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const router = useRouter();

    /**
     * Tap a memory row → stash the content in module-level transient state,
     * then navigate back to the previous screen (typically the session view).
     * SessionView's useFocusEffect picks it up and appends to the input.
     * Edit/delete remain available via the explicit per-row icons.
     */
    const handleUse = React.useCallback((m: MemoryRow) => {
        setPendingMemoryInjection(m.content);
        hapticsLight();
        if (router.canGoBack()) {
            router.back();
        } else {
            // Edge case: opened directly via deep link with no back stack.
            // Drop user on the inbox so the session input on screen is visible.
            router.replace('/');
        }
    }, [router]);

    const refresh = React.useCallback(async (silent: boolean = false) => {
        if (!auth.credentials) return;
        if (silent) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);
        try {
            const list = await listMemories(auth.credentials);
            setMemories(list);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load memories');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [auth.credentials]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    const handleAdd = React.useCallback(async () => {
        if (!auth.credentials) return;
        const content = await Modal.prompt(
            t('memory.addTitle'),
            t('memory.addPrompt'),
            { defaultValue: '', confirmText: t('memory.save'), cancelText: t('common.cancel'), multiline: true, multilineRows: 8 },
        );
        const trimmed = content?.trim();
        if (!trimmed) return;
        try {
            await createMemory(auth.credentials, { content: trimmed, source: 'manual' });
            hapticsLight();
            showToast(t('memory.saved'));
            void refresh(true);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.saveFailed'));
        }
    }, [auth.credentials, refresh]);

    const handleEdit = React.useCallback(async (m: MemoryRow) => {
        if (!auth.credentials) return;
        const content = await Modal.prompt(
            t('memory.editTitle'),
            t('memory.editPrompt'),
            { defaultValue: m.content, confirmText: t('memory.save'), cancelText: t('common.cancel'), multiline: true, multilineRows: 8 },
        );
        const trimmed = content?.trim();
        if (!trimmed || trimmed === m.content) return;
        try {
            await updateMemory(auth.credentials, m.id, trimmed);
            hapticsLight();
            showToast(t('memory.saved'));
            void refresh(true);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.saveFailed'));
        }
    }, [auth.credentials, refresh]);

    const handleDelete = React.useCallback(async (m: MemoryRow) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(
            t('memory.deleteTitle'),
            t('memory.deleteConfirm'),
            { confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true },
        );
        if (!confirmed) return;
        try {
            await deleteMemory(auth.credentials, m.id);
            hapticsLight();
            showToast(t('memory.deleted'));
            void refresh(true);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.deleteFailed'));
        }
    }, [auth.credentials, refresh]);

    const addButton = React.useMemo(() => (
        <Pressable onPress={handleAdd} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            <Ionicons name="add" size={24} color={theme.colors.header.tint} />
        </Pressable>
    ), [theme, handleAdd]);
    useDrawerHeaderRight(addButton);

    const formatDate = (ms: number) => {
        const d = new Date(ms);
        return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };

    const groupedSections = React.useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const filtered = q
            ? memories.filter((m) => m.content.toLowerCase().includes(q))
            : memories;
        const buckets: Record<GroupKey, MemoryRow[]> = { 'manual': [], 'message-pin': [] };
        for (const m of filtered) {
            const key: GroupKey = m.source === 'message-pin' ? 'message-pin' : 'manual';
            buckets[key].push(m);
        }
        for (const k of GROUP_ORDER) {
            buckets[k].sort((a, b) => b.createdAt - a.createdAt);
        }
        return GROUP_ORDER
            .map((key) => ({ key, items: buckets[key] }))
            .filter((s) => s.items.length > 0);
    }, [memories, searchQuery]);

    const renderRow = (m: MemoryRow, isLast: boolean) => {
        const truncated = m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content;
        return (
            <View key={m.id} style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: isLast ? 0 : 0.5,
                borderBottomColor: theme.colors.divider,
            }}>
                <Pressable onPress={() => handleUse(m)} onLongPress={() => handleDelete(m)}>
                    <Text style={{
                        fontSize: 15,
                        color: theme.colors.text,
                        ...Typography.default(),
                    }}>
                        {truncated}
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                            {formatDate(m.createdAt)}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                            <Pressable onPress={() => handleEdit(m)} hitSlop={10}>
                                <Ionicons name="create-outline" size={16} color={theme.colors.textSecondary} />
                            </Pressable>
                            <Pressable onPress={() => handleDelete(m)} hitSlop={10}>
                                <Ionicons name="trash-outline" size={16} color={theme.colors.deleteAction} />
                            </Pressable>
                        </View>
                    </View>
                </Pressable>
            </View>
        );
    };

    const groupLabel = (key: GroupKey, count: number) => {
        const label = key === 'manual' ? t('memory.groupManual') : t('memory.groupMessagePin');
        return `${label} · ${count}`;
    };

    const searchBar = (
        <View style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
        }}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.input.background,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
            }}>
                <Octicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('memory.searchPlaceholder')}
                    style={{
                        flex: 1,
                        fontSize: 16,
                        height: 24,
                        color: theme.colors.text,
                        ...Typography.default(),
                    }}
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                    <Pressable
                        onPress={() => setSearchQuery('')}
                        hitSlop={8}
                        style={{ marginLeft: 8 }}
                    >
                        <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>
        </View>
    );

    const totalFiltered = groupedSections.reduce((sum, s) => sum + s.items.length, 0);
    const isSearching = searchQuery.trim().length > 0;

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {!isInDrawer && <Stack.Screen
                options={{
                    title: t('memory.title'),
                    headerRight: () => addButton,
                }}
            />}
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
            ) : memories.length === 0 ? (
                <ScrollView
                    contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}
                    refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh(true)} />}
                >
                    <Ionicons name="library-outline" size={56} color={theme.colors.textSecondary} />
                    <Text style={{ marginTop: 16, fontSize: 16, color: theme.colors.text, textAlign: 'center', ...Typography.default('semiBold') }}>
                        {t('memory.emptyTitle')}
                    </Text>
                    <Text style={{ marginTop: 8, fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', maxWidth: 280, ...Typography.default() }}>
                        {t('memory.emptyDescription')}
                    </Text>
                    <Pressable
                        onPress={handleAdd}
                        style={({ pressed }) => ({
                            marginTop: 24,
                            paddingHorizontal: 16,
                            paddingVertical: 10,
                            borderRadius: 10,
                            backgroundColor: theme.colors.button.primary.background,
                            opacity: pressed ? 0.7 : 1,
                        })}
                    >
                        <Text style={{ color: theme.colors.button.primary.tint, fontSize: 14, ...Typography.default('semiBold') }}>
                            {t('memory.addTitle')}
                        </Text>
                    </Pressable>
                </ScrollView>
            ) : (
                <>
                    {searchBar}
                    <ScrollView
                        contentContainerStyle={{ paddingBottom: 24 }}
                        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh(true)} />}
                        keyboardShouldPersistTaps="handled"
                    >
                        {totalFiltered === 0 ? (
                            <View style={{
                                flex: 1,
                                alignItems: 'center',
                                paddingTop: 64,
                                paddingHorizontal: 32,
                            }}>
                                <Ionicons name="search-outline" size={48} color={theme.colors.textSecondary} />
                                <Text style={{
                                    marginTop: 16,
                                    fontSize: 15,
                                    color: theme.colors.text,
                                    textAlign: 'center',
                                    ...Typography.default('semiBold'),
                                }}>
                                    {t('memory.searchEmpty')}
                                </Text>
                                <Text style={{
                                    marginTop: 6,
                                    fontSize: 13,
                                    color: theme.colors.textSecondary,
                                    textAlign: 'center',
                                    ...Typography.default(),
                                }}>
                                    {t('memory.searchEmptyHint')}
                                </Text>
                            </View>
                        ) : (
                            <>
                                <Text style={{ paddingHorizontal: 16, paddingTop: 12, fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                                    {isSearching
                                        ? t('memory.searchResultFooter', { count: totalFiltered })
                                        : t('memory.listFooter', { count: memories.length })}
                                </Text>
                                {groupedSections.map((section) => (
                                    <View key={section.key} style={{ marginTop: 12 }}>
                                        <View style={{
                                            backgroundColor: theme.colors.surfaceHigh,
                                            paddingHorizontal: 16,
                                            paddingVertical: 8,
                                            borderTopWidth: Platform.select({ ios: 0.33, default: 1 }),
                                            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                            borderColor: theme.colors.divider,
                                        }}>
                                            <Text style={{
                                                fontSize: 13,
                                                color: theme.colors.textSecondary,
                                                ...Typography.default('semiBold'),
                                            }}>
                                                {groupLabel(section.key, section.items.length)}
                                            </Text>
                                        </View>
                                        {section.items.map((m, idx) => renderRow(m, idx === section.items.length - 1))}
                                    </View>
                                ))}
                            </>
                        )}
                    </ScrollView>
                </>
            )}
        </View>
    );
}
