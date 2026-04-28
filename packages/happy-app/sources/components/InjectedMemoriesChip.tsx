import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { loadMutedMemoryIds } from '@/sync/persistence';
import { hapticsLight } from '@/components/haptics';
import { InjectedMemoriesModal } from '@/components/InjectedMemoriesModal';
import { t } from '@/text';

interface InjectedMemoriesChipProps {
    sessionId: string;
    injectedMemoryIds: string[];
}

export const InjectedMemoriesChip = React.memo(({ sessionId, injectedMemoryIds }: InjectedMemoriesChipProps) => {
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    // Mute state lives in localStorage; reading once on mount keeps the muted-count
    // badge in sync without the chip having to re-fetch when the modal toggles a row.
    const mutedCount = React.useMemo(() => {
        const muted = new Set(loadMutedMemoryIds(sessionId));
        return injectedMemoryIds.reduce((acc, id) => acc + (muted.has(id) ? 1 : 0), 0);
    }, [sessionId, injectedMemoryIds, open]);

    if (injectedMemoryIds.length === 0) return null;

    const count = injectedMemoryIds.length;

    return (
        <>
            <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 4 }}>
                <Pressable
                    onPress={() => { hapticsLight(); setOpen(true); }}
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

            <InjectedMemoriesModal
                visible={open}
                onClose={() => setOpen(false)}
                sessionId={sessionId}
                injectedMemoryIds={injectedMemoryIds}
            />
        </>
    );
});

InjectedMemoriesChip.displayName = 'InjectedMemoriesChip';
