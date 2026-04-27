import * as React from 'react';
import { View, Pressable, ActivityIndicator, Platform } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from './layout';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, type MemoryRow } from '@/sync/apiMemory';
import { hapticsLight } from '@/components/haptics';
import { t } from '@/text';

interface MemoryPickerSheetProps {
    /** Called with the picked memory's content. The sheet will dismiss itself afterwards. */
    onSelect: (content: string) => void;
}

/**
 * Bottom-sheet "memory clipboard": lists the user's saved memories and lets
 * them tap one to paste it into the chat input. Acts like a system clipboard
 * picker — *not* an automatic context injector. Memory still lives on the
 * server (DB-backed), so this list syncs across devices.
 */
export const MemoryPickerSheet = React.memo(React.forwardRef<BottomSheetModal, MemoryPickerSheetProps>(({ onSelect }, ref) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const [memories, setMemories] = React.useState<MemoryRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = React.useCallback(async () => {
        if (!auth.credentials) return;
        setLoading(true);
        setError(null);
        try {
            const list = await listMemories(auth.credentials);
            setMemories(list);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load memories');
        } finally {
            setLoading(false);
        }
    }, [auth.credentials]);

    // Fetch when the sheet opens (index >= 0). onDismiss not relevant here.
    const handleChange = React.useCallback((index: number) => {
        if (index >= 0) {
            void refresh();
        }
    }, [refresh]);

    const innerRef = ref as React.RefObject<BottomSheetModal>;
    const handlePick = React.useCallback((m: MemoryRow) => {
        hapticsLight();
        onSelect(m.content);
        innerRef.current?.dismiss();
    }, [onSelect, innerRef]);

    const handleManage = React.useCallback(() => {
        innerRef.current?.dismiss();
        router.push('/memory');
    }, [innerRef, router]);

    const renderBackdrop = React.useCallback(
        (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
        [],
    );

    return (
        <BottomSheetModal
            ref={ref}
            snapPoints={['60%']}
            enableDynamicSizing={false}
            onChange={handleChange}
            backdropComponent={renderBackdrop}
            // Constrain to chat column width on tablet/web; full width on phones.
            style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
            backgroundStyle={{ backgroundColor: theme.colors.surface }}
            handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
        >
            <View style={{ flex: 1 }}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingBottom: 12,
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
            }}>
                <Ionicons name="library-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
                <Text style={{ flex: 1, fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') }}>
                    {t('memory.title')}
                </Text>
                <Pressable onPress={handleManage} hitSlop={10}>
                    <Text style={{ fontSize: 13, color: theme.colors.button.primary.background, ...Typography.default() }}>
                        {t('memory.manage')}
                    </Text>
                </Pressable>
            </View>
            <BottomSheetScrollView contentContainerStyle={{ paddingVertical: 8 }}>
                {loading ? (
                    <View style={{ padding: 32, alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <View style={{ padding: 32, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', ...Typography.default() }}>
                            {error}
                        </Text>
                    </View>
                ) : memories.length === 0 ? (
                    <View style={{ paddingHorizontal: 32, paddingVertical: 40, alignItems: 'center' }}>
                        <Ionicons name="library-outline" size={40} color={theme.colors.textSecondary} />
                        <Text style={{ marginTop: 12, fontSize: 14, color: theme.colors.text, textAlign: 'center', ...Typography.default('semiBold') }}>
                            {t('memory.emptyTitle')}
                        </Text>
                        <Pressable
                            onPress={handleManage}
                            style={({ pressed }) => ({
                                marginTop: 16,
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: 8,
                                backgroundColor: theme.colors.button.primary.background,
                                opacity: pressed ? 0.7 : 1,
                            })}
                        >
                            <Text style={{ color: theme.colors.button.primary.tint, fontSize: 13, ...Typography.default('semiBold') }}>
                                {t('memory.addTitle')}
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    memories.map((m) => {
                        const preview = m.content.length > 240 ? m.content.slice(0, 240) + '…' : m.content;
                        return (
                            <Pressable
                                key={m.id}
                                onPress={() => handlePick(m)}
                                style={({ pressed }) => ({
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    borderBottomWidth: 0.5,
                                    borderBottomColor: theme.colors.divider,
                                    backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                                })}
                            >
                                <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                    {preview}
                                </Text>
                            </Pressable>
                        );
                    })
                )}
            </BottomSheetScrollView>
            </View>
        </BottomSheetModal>
    );
}));

MemoryPickerSheet.displayName = 'MemoryPickerSheet';
