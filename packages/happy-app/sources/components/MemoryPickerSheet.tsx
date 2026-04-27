import * as React from 'react';
import { View, Pressable, ActivityIndicator, Platform, Modal as RNModal, ScrollView, useWindowDimensions, TextInput } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { listMemories, createMemory, updateMemory, deleteMemory, type MemoryRow } from '@/sync/apiMemory';
import { hapticsLight } from '@/components/haptics';
import { showToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { t } from '@/text';

export type MemoryPickerHandle = { present: () => void; dismiss: () => void };

interface MemoryPickerSheetProps {
    /**
     * Backward-compat secondary action: when provided, each row gets a small
     * copy-into-input button. The primary row tap is now edit-in-place.
     */
    onSelect?: (content: string) => void;
}

const SheetTextInputComp: React.ComponentType<any> = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

interface ManagedList {
    memories: MemoryRow[];
    loading: boolean;
    error: string | null;
    setMemories: React.Dispatch<React.SetStateAction<MemoryRow[]>>;
}

const useMemoryList = (open: boolean): ManagedList => {
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

    return { memories, loading, error, setMemories };
};

interface ContentProps {
    list: ManagedList;
    theme: any;
    onSelect?: (content: string) => void;
    Scroller: React.ComponentType<any>;
}

const PickerContent = React.memo(({ list, theme, onSelect, Scroller }: ContentProps) => {
    const { memories, loading, error, setMemories } = list;
    const auth = useAuth();
    const [search, setSearch] = React.useState('');

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return memories;
        return memories.filter(m => m.content.toLowerCase().includes(q));
    }, [memories, search]);

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
            const created = await createMemory(auth.credentials, { content: trimmed, source: 'manual' });
            hapticsLight();
            showToast(t('memory.saved'));
            setMemories(prev => [created, ...prev.filter(m => m.id !== created.id)]);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.saveFailed'));
        }
    }, [auth.credentials, setMemories]);

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
            const updated = await updateMemory(auth.credentials, m.id, trimmed);
            hapticsLight();
            showToast(t('memory.saved'));
            setMemories(prev => prev.map(x => x.id === m.id ? updated : x));
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.saveFailed'));
        }
    }, [auth.credentials, setMemories]);

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
            setMemories(prev => prev.filter(x => x.id !== m.id));
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.deleteFailed'));
        }
    }, [auth.credentials, setMemories]);

    const handleInsert = React.useCallback((m: MemoryRow) => {
        if (!onSelect) return;
        hapticsLight();
        onSelect(m.content);
    }, [onSelect]);

    return (
        <>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: 8,
            }}>
                <Ionicons name="library-outline" size={20} color={theme.colors.text} style={{ marginRight: 8 }} />
                <Text style={{ flex: 1, fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') }}>
                    {t('memory.title')}
                </Text>
                <Pressable onPress={handleAdd} hitSlop={10} style={({ pressed }) => ({ paddingHorizontal: 4, opacity: pressed ? 0.5 : 1 })}>
                    <Ionicons name="add" size={26} color={theme.colors.button.primary.background} />
                </Pressable>
            </View>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginHorizontal: 16,
                marginBottom: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: theme.colors.surfacePressed,
            }}>
                <Ionicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                <SheetTextInputComp
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t('memory.searchPlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    style={{
                        flex: 1,
                        fontSize: 14,
                        color: theme.colors.text,
                        padding: 0,
                        ...Typography.default(),
                    }}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {search.length > 0 ? (
                    <Pressable onPress={() => setSearch('')} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                        <Ionicons name="close-circle" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                ) : null}
            </View>
            <View style={{ height: Platform.select({ ios: 0.33, default: 1 }), backgroundColor: theme.colors.divider }} />
            <Scroller
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingVertical: 4 }}
                keyboardShouldPersistTaps="handled"
            >
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
                        <Text style={{ marginTop: 6, fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', maxWidth: 260, ...Typography.default() }}>
                            {t('memory.emptyDescription')}
                        </Text>
                        <Pressable
                            onPress={handleAdd}
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
                ) : filtered.length === 0 ? (
                    <View style={{ paddingHorizontal: 32, paddingVertical: 40, alignItems: 'center' }}>
                        <Ionicons name="search" size={32} color={theme.colors.textSecondary} />
                        <Text style={{ marginTop: 8, fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', ...Typography.default() }}>
                            {t('memory.noResults')}
                        </Text>
                    </View>
                ) : (
                    filtered.map((m) => {
                        const preview = m.content.length > 240 ? m.content.slice(0, 240) + '…' : m.content;
                        return (
                            <View
                                key={m.id}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'flex-start',
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    borderBottomWidth: 0.5,
                                    borderBottomColor: theme.colors.divider,
                                }}
                            >
                                <Pressable
                                    onPress={() => onSelect ? handleInsert(m) : handleEdit(m)}
                                    style={({ pressed }) => ({
                                        flex: 1,
                                        opacity: pressed ? 0.6 : 1,
                                    })}
                                    accessibilityLabel={onSelect ? t('memory.insertIntoInput') : t('memory.editTitle')}
                                >
                                    <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                        {preview}
                                    </Text>
                                </Pressable>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                                    {onSelect ? (
                                        <Pressable
                                            onPress={() => handleEdit(m)}
                                            hitSlop={8}
                                            style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.4 : 0.7 })}
                                            accessibilityLabel={t('memory.editTitle')}
                                        >
                                            <Ionicons name="create-outline" size={16} color={theme.colors.textSecondary} />
                                        </Pressable>
                                    ) : null}
                                    <Pressable
                                        onPress={() => handleDelete(m)}
                                        hitSlop={8}
                                        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
                                        accessibilityLabel={t('common.delete')}
                                    >
                                        <Ionicons name="trash-outline" size={16} color={theme.colors.deleteAction} />
                                    </Pressable>
                                </View>
                            </View>
                        );
                    })
                )}
            </Scroller>
        </>
    );
});
PickerContent.displayName = 'PickerContent';

/**
 * One-stop quick-manage panel for memories.
 *
 * Web/desktop: full-height right-side drawer (slides in from the right).
 * Native: bottom sheet (mobile-idiomatic).
 *
 * Sheet now hosts add/edit/delete inline (Modal.prompt / Modal.confirm) and
 * keeps `onSelect` as a hidden secondary action so existing callers (e.g.
 * AgentInput) can still insert a memory into the input.
 */
export const MemoryPickerSheet = React.memo(React.forwardRef<MemoryPickerHandle, MemoryPickerSheetProps>(({ onSelect }, ref) => {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const isWeb = Platform.OS === 'web';

    const [open, setOpen] = React.useState(false);
    const webList = useMemoryList(open);

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

    const renderBackdrop = React.useCallback(
        (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
        [],
    );

    if (isWeb) {
        const drawerWidth = Math.min(420, Math.max(320, width * 0.32));
        return (
            <RNModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <Pressable
                    onPress={() => setOpen(false)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
                >
                    <Pressable
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
                            list={webList}
                            theme={theme}
                            onSelect={onSelect}
                            Scroller={ScrollView}
                        />
                    </Pressable>
                </Pressable>
            </RNModal>
        );
    }

    const handleChange = (index: number) => {
        setNativeOpen(index >= 0);
    };

    return (
        <BottomSheetModal
            ref={sheetRef}
            snapPoints={['70%']}
            enableDynamicSizing={false}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            onChange={handleChange}
            backdropComponent={renderBackdrop}
            backgroundStyle={{ backgroundColor: theme.colors.surface }}
            handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
        >
            <View style={{ flex: 1 }}>
                <PickerContent
                    list={nativeList}
                    theme={theme}
                    onSelect={onSelect}
                    Scroller={BottomSheetScrollView}
                />
            </View>
        </BottomSheetModal>
    );
}));

MemoryPickerSheet.displayName = 'MemoryPickerSheet';
