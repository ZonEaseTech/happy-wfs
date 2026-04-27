import * as React from 'react';
import { View, Pressable, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDesktopRoute, useDrawerHeaderRight } from '@/components/desktopRoutes';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, createMemory, updateMemory, deleteMemory, type MemoryRow } from '@/sync/apiMemory';
import { showToast } from '@/components/Toast';
import { hapticsLight } from '@/components/haptics';
import { t } from '@/text';

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
    const router = useRouter();
    const auth = useAuth();
    const [memories, setMemories] = React.useState<MemoryRow[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

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
            { defaultValue: '', confirmText: t('memory.save'), cancelText: t('common.cancel') },
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
            { defaultValue: m.content, confirmText: t('memory.save'), cancelText: t('common.cancel') },
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

    const renderRow = (m: MemoryRow) => {
        const truncated = m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content;
        const sourceLabel = m.source === 'message-pin' ? t('memory.sourcePin') : t('memory.sourceManual');
        return (
            <View key={m.id} style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.divider,
            }}>
                <Pressable onPress={() => handleEdit(m)} onLongPress={() => handleDelete(m)}>
                    <Text style={{
                        fontSize: 15,
                        color: theme.colors.text,
                        ...Typography.default(),
                    }}>
                        {truncated}
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}>
                            {sourceLabel} · {formatDate(m.createdAt)}
                        </Text>
                        <Pressable onPress={() => handleDelete(m)} hitSlop={10}>
                            <Ionicons name="trash-outline" size={16} color={theme.colors.deleteAction} />
                        </Pressable>
                    </View>
                </Pressable>
            </View>
        );
    };

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
                <ScrollView
                    contentContainerStyle={{ paddingVertical: 8 }}
                    refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh(true)} />}
                >
                    <Text style={{ paddingHorizontal: 16, paddingTop: 8, fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                        {t('memory.listFooter', { count: memories.length })}
                    </Text>
                    {memories.map(renderRow)}
                </ScrollView>
            )}
        </View>
    );
}
