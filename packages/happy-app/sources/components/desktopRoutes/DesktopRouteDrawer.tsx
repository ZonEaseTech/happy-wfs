import * as React from 'react';
import { View, Pressable, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { loadDesktopRoute } from './registry';
import { DesktopRouteContext } from './useDesktopRoute';

export interface DrawerEntry {
    id: string;
    path: string;
    params: Record<string, any>;
    title?: string;
}

interface Props {
    entry: DrawerEntry;
    depth: number;
    isTop: boolean;
    onDismiss: () => void;
}

const DRAWER_WIDTH = 480;
const STACK_OFFSET = 32;

export const DesktopRouteDrawer = React.memo(function DesktopRouteDrawer({ entry, depth, isTop, onDismiss }: Props) {
    const { theme } = useUnistyles();
    const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        const loader = loadDesktopRoute(entry.path);
        if (!loader) {
            setComponent(null);
            return;
        }
        loader()
            .then((mod) => { if (!cancelled) setComponent(() => mod.default); })
            .catch(() => { if (!cancelled) setComponent(null); });
        return () => { cancelled = true; };
    }, [entry.path]);

    const ctxValue = React.useMemo(() => ({
        isInDrawer: true,
        params: entry.params,
        dismiss: onDismiss,
    }), [entry.params, onDismiss]);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
            <Pressable
                onPress={isTop ? onDismiss : undefined}
                style={{
                    flex: 1,
                    backgroundColor: depth === 0 ? 'rgba(0,0,0,0.35)' : 'transparent',
                }}
            >
                <Pressable
                    onPress={(e: any) => e.stopPropagation?.()}
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        right: depth * STACK_OFFSET,
                        width: DRAWER_WIDTH,
                        backgroundColor: theme.colors.surface,
                        shadowColor: '#000',
                        shadowOffset: { width: -2, height: 0 },
                        shadowOpacity: 0.18,
                        shadowRadius: 16,
                        elevation: 12,
                    }}
                >
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 12,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                    }}>
                        <Pressable onPress={onDismiss} hitSlop={10} style={{ padding: 4, marginRight: 4 }}>
                            <Ionicons name="close" size={22} color={theme.colors.text} />
                        </Pressable>
                        <Text style={{ flex: 1, fontSize: 16, color: theme.colors.text, ...Typography.default('semiBold') }} numberOfLines={1}>
                            {entry.title ?? ''}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <DesktopRouteContext.Provider value={ctxValue}>
                            {Component ? (
                                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
                                    <Component />
                                </ScrollView>
                            ) : (
                                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                </View>
                            )}
                        </DesktopRouteContext.Provider>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
});
