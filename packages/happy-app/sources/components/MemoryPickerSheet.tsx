import * as React from 'react';
import { View, Pressable, ActivityIndicator, Platform, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, type MemoryRow } from '@/sync/apiMemory';
import { hapticsLight } from '@/components/haptics';
import { t } from '@/text';

export type MemoryPickerHandle = { present: () => void; dismiss: () => void };

interface MemoryPickerSheetProps {
    onSelect: (content: string) => void;
}

const useMemoryList = (open: boolean) => {
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

    React.useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    return { memories, loading, error };
};

interface ContentProps {
    memories: MemoryRow[];
    loading: boolean;
    error: string | null;
    theme: any;
    onPick: (m: MemoryRow) => void;
    onManage: () => void;
    Scroller: React.ComponentType<any>;
}

const PickerContent = React.memo(({ memories, loading, error, theme, onPick, onManage, Scroller }: ContentProps) => {
    return (
        <>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
            }}>
                <Ionicons name="library-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
                <Text style={{ flex: 1, fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') }}>
                    {t('memory.title')}
                </Text>
                <Pressable onPress={onManage} hitSlop={10}>
                    <Text style={{ fontSize: 13, color: theme.colors.button.primary.background, ...Typography.default() }}>
                        {t('memory.manage')}
                    </Text>
                </Pressable>
            </View>
            <Scroller style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
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
                            onPress={onManage}
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
                                onPress={() => onPick(m)}
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
            </Scroller>
        </>
    );
});
PickerContent.displayName = 'PickerContent';

/**
 * Web/desktop: full-height right-side drawer (slides in from the right).
 * Native: bottom sheet (mobile-idiomatic).
 *
 * Both expose the same imperative handle: { present, dismiss }.
 */
export const MemoryPickerSheet = React.memo(React.forwardRef<MemoryPickerHandle, MemoryPickerSheetProps>(({ onSelect }, ref) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { width } = useWindowDimensions();
    const isWeb = Platform.OS === 'web';

    // ---- web/desktop drawer ----
    const [open, setOpen] = React.useState(false);
    const { memories, loading, error } = useMemoryList(open);

    const sheetRef = React.useRef<BottomSheetModal>(null);
    const [nativeOpen, setNativeOpen] = React.useState(false);
    const nativeList = useMemoryList(nativeOpen);

    React.useImperativeHandle(ref, () => ({
        present: () => {
            if (isWeb) setOpen(true);
            else sheetRef.current?.present();
        },
        dismiss: () => {
            if (isWeb) setOpen(false);
            else sheetRef.current?.dismiss();
        },
    }), [isWeb]);

    const handlePick = React.useCallback((m: MemoryRow) => {
        hapticsLight();
        onSelect(m.content);
        if (isWeb) setOpen(false);
        else sheetRef.current?.dismiss();
    }, [onSelect, isWeb]);

    const handleManage = React.useCallback(() => {
        if (isWeb) setOpen(false);
        else sheetRef.current?.dismiss();
        router.push('/memory');
    }, [router, isWeb]);

    const renderBackdrop = React.useCallback(
        (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
        [],
    );

    if (isWeb) {
        // Drawer width: capped, fits narrow viewports.
        const drawerWidth = Math.min(420, Math.max(320, width * 0.32));
        return (
            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <Pressable
                    onPress={() => setOpen(false)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
                >
                    <Pressable
                        // Inner pressable swallows clicks so tapping the panel doesn't close it.
                        onPress={(e) => e.stopPropagation?.()}
                        style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            right: 0,
                            width: drawerWidth,
                            backgroundColor: theme.colors.surface,
                            shadowColor: '#000',
                            shadowOffset: { width: -2, height: 0 },
                            shadowOpacity: 0.15,
                            shadowRadius: 12,
                            elevation: 12,
                        }}
                    >
                        <PickerContent
                            memories={memories}
                            loading={loading}
                            error={error}
                            theme={theme}
                            onPick={handlePick}
                            onManage={handleManage}
                            Scroller={ScrollView}
                        />
                    </Pressable>
                </Pressable>
            </Modal>
        );
    }

    // Native: bottom sheet
    const handleChange = (index: number) => {
        setNativeOpen(index >= 0);
    };

    return (
        <BottomSheetModal
            ref={sheetRef}
            snapPoints={['60%']}
            enableDynamicSizing={false}
            onChange={handleChange}
            backdropComponent={renderBackdrop}
            backgroundStyle={{ backgroundColor: theme.colors.surface }}
            handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
        >
            <View style={{ flex: 1 }}>
                <PickerContent
                    memories={nativeList.memories}
                    loading={nativeList.loading}
                    error={nativeList.error}
                    theme={theme}
                    onPick={handlePick}
                    onManage={handleManage}
                    Scroller={BottomSheetScrollView}
                />
            </View>
        </BottomSheetModal>
    );
}));

MemoryPickerSheet.displayName = 'MemoryPickerSheet';
