import * as React from 'react';
import { View, Pressable, Modal, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, type MemoryRow } from '@/sync/apiMemory';
import { loadMutedMemoryIds, saveMutedMemoryIds } from '@/sync/persistence';
import { t } from '@/text';

interface InjectedMemoriesModalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    injectedMemoryIds: string[];
}

/**
 * Controlled modal that lists the memories injected into a session's system
 * prompt and lets the user mute individual entries for the local session.
 *
 * Used by `InjectedMemoriesChip` (Info panel) and `SessionView` header. Both
 * share this modal so behavior + count semantics stay aligned.
 */
export const InjectedMemoriesModal = React.memo(({ visible, onClose, sessionId, injectedMemoryIds }: InjectedMemoriesModalProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const [memories, setMemories] = React.useState<MemoryRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [mutedIds, setMutedIds] = React.useState<Set<string>>(() => new Set(loadMutedMemoryIds(sessionId)));

    const idSet = React.useMemo(() => new Set(injectedMemoryIds), [injectedMemoryIds]);

    React.useEffect(() => {
        if (!visible || !auth.credentials) return;
        let cancelled = false;
        setLoading(true);
        listMemories(auth.credentials)
            .then(list => { if (!cancelled) setMemories(list.filter((m) => idSet.has(m.id))); })
            .catch(() => { if (!cancelled) setMemories([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [visible, auth.credentials, idSet]);

    const toggleMute = React.useCallback((memoryId: string, nextMuted: boolean) => {
        setMutedIds((prev) => {
            const next = new Set(prev);
            if (nextMuted) next.add(memoryId);
            else next.delete(memoryId);
            saveMutedMemoryIds(sessionId, Array.from(next));
            return next;
        });
    }, [sessionId]);

    const handleManageAll = React.useCallback(() => {
        onClose();
        router.push('/memory');
    }, [onClose, router]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                onPress={onClose}
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
                        <Pressable onPress={onClose} hitSlop={10}>
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
                    <Pressable
                        onPress={handleManageAll}
                        style={({ pressed }) => ({
                            paddingHorizontal: 16,
                            paddingVertical: 12,
                            borderTopWidth: 0.5,
                            borderTopColor: theme.colors.divider,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            opacity: pressed ? 0.6 : 1,
                        })}
                    >
                        <Text style={{ fontSize: 13, color: theme.colors.button.primary.background, ...Typography.default('semiBold') }}>
                            {t('injectedMemories.manageAll')}
                        </Text>
                        <Ionicons name="arrow-forward" size={14} color={theme.colors.button.primary.background} />
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
});

InjectedMemoriesModal.displayName = 'InjectedMemoriesModal';
