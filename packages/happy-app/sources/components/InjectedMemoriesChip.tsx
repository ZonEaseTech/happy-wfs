import * as React from 'react';
import { View, Pressable, Modal, ScrollView, ActivityIndicator, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, type MemoryRow } from '@/sync/apiMemory';
import { loadMutedMemoryIds, saveMutedMemoryIds } from '@/sync/persistence';
import { hapticsLight } from '@/components/haptics';
import { t } from '@/text';

interface InjectedMemoriesChipProps {
    sessionId: string;
    injectedMemoryIds: string[];
}

export const InjectedMemoriesChip = React.memo(({ sessionId, injectedMemoryIds }: InjectedMemoriesChipProps) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [open, setOpen] = React.useState(false);
    const [memories, setMemories] = React.useState<MemoryRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [mutedIds, setMutedIds] = React.useState<Set<string>>(() => new Set(loadMutedMemoryIds(sessionId)));

    const idSet = React.useMemo(() => new Set(injectedMemoryIds), [injectedMemoryIds]);

    const handleOpen = React.useCallback(async () => {
        if (injectedMemoryIds.length === 0) return;
        hapticsLight();
        setOpen(true);
        if (!auth.credentials) return;
        setLoading(true);
        try {
            const list = await listMemories(auth.credentials);
            setMemories(list.filter((m) => idSet.has(m.id)));
        } catch (_) {
            setMemories([]);
        } finally {
            setLoading(false);
        }
    }, [auth.credentials, injectedMemoryIds.length, idSet]);

    const toggleMute = React.useCallback((memoryId: string, nextMuted: boolean) => {
        setMutedIds((prev) => {
            const next = new Set(prev);
            if (nextMuted) next.add(memoryId);
            else next.delete(memoryId);
            saveMutedMemoryIds(sessionId, Array.from(next));
            return next;
        });
    }, [sessionId]);

    if (injectedMemoryIds.length === 0) return null;

    const count = injectedMemoryIds.length;
    const mutedCount = injectedMemoryIds.reduce((acc, id) => acc + (mutedIds.has(id) ? 1 : 0), 0);

    return (
        <>
            <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 4 }}>
                <Pressable
                    onPress={handleOpen}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
                        borderWidth: Platform.select({ ios: 0.5, default: 1 }),
                        borderColor: theme.colors.divider,
                    })}
                >
                    <Ionicons name="library-outline" size={14} color={theme.colors.button.secondary.tint} />
                    <Text style={{ fontSize: 12, color: theme.colors.text, fontWeight: '600', ...Typography.default('semiBold') }}>
                        {t('injectedMemories.chip', { count })}
                    </Text>
                    {mutedCount > 0 && (
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>
                            {t('injectedMemories.mutedCount', { count: mutedCount })}
                        </Text>
                    )}
                </Pressable>
            </View>

            <Modal
                visible={open}
                transparent
                animationType="fade"
                onRequestClose={() => setOpen(false)}
            >
                <Pressable
                    onPress={() => setOpen(false)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
                >
                    <Pressable
                        onPress={(e) => e.stopPropagation?.()}
                        style={{
                            width: '90%',
                            maxWidth: 480,
                            maxHeight: '80%',
                            backgroundColor: theme.colors.surface,
                            borderRadius: 14,
                            overflow: 'hidden',
                        }}
                    >
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: 16,
                            paddingVertical: 14,
                            borderBottomWidth: 0.5,
                            borderBottomColor: theme.colors.divider,
                        }}>
                            <Ionicons name="library-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
                            <Text style={{ flex: 1, fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') }}>
                                {t('injectedMemories.title')}
                            </Text>
                            <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                                <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                        <Text style={{
                            paddingHorizontal: 16,
                            paddingTop: 10,
                            paddingBottom: 6,
                            fontSize: 12,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                        }}>
                            {t('injectedMemories.muteHint')}
                        </Text>
                        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingVertical: 4 }}>
                            {loading ? (
                                <View style={{ padding: 32, alignItems: 'center' }}>
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                </View>
                            ) : memories.length === 0 ? (
                                <View style={{ padding: 32, alignItems: 'center' }}>
                                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', ...Typography.default() }}>
                                        {t('injectedMemories.empty')}
                                    </Text>
                                </View>
                            ) : (
                                memories.map((m) => {
                                    const muted = mutedIds.has(m.id);
                                    const preview = m.content.length > 320 ? m.content.slice(0, 320) + '…' : m.content;
                                    return (
                                        <View
                                            key={m.id}
                                            style={{
                                                paddingHorizontal: 16,
                                                paddingVertical: 12,
                                                borderBottomWidth: 0.5,
                                                borderBottomColor: theme.colors.divider,
                                                flexDirection: 'row',
                                                alignItems: 'flex-start',
                                                gap: 12,
                                                opacity: muted ? 0.55 : 1,
                                            }}
                                        >
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                                    {preview}
                                                </Text>
                                                <Text style={{ marginTop: 6, fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>
                                                    {muted ? t('injectedMemories.mutedBadge') : t('injectedMemories.activeBadge')}
                                                </Text>
                                            </View>
                                            <Switch
                                                value={muted}
                                                onValueChange={(v) => toggleMute(m.id, v)}
                                            />
                                        </View>
                                    );
                                })
                            )}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
});

InjectedMemoriesChip.displayName = 'InjectedMemoriesChip';
