import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { hapticsLight } from '@/components/haptics';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { layout } from '@/components/layout';
import { showCopiedToast, showToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { buildPortProxyUrl, deletePortProxy, listPortProxies, updatePortProxy, type PortProxyRecord } from '@/sync/apiPortProxy';
import { getServerUrl } from '@/sync/serverConfig';
import { useAllMachines } from '@/sync/storage';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingBottom: 24,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyIcon: {
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 20,
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 16,
        ...Typography.default(),
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    addButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    addButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 16,
        ...Typography.default('semiBold'),
    },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    statusPill: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statusText: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    errorText: {
        paddingHorizontal: 24,
        paddingTop: 12,
        color: theme.colors.textDestructive,
        fontSize: 14,
        ...Typography.default(),
    },
}));

function machineName(machineId: string, machines: ReturnType<typeof useAllMachines>): string {
    const machine = machines.find((item) => item.id === machineId);
    return machine?.metadata?.displayName || machine?.metadata?.host || machineId;
}

function proxySubtitle(proxy: PortProxyRecord, machines: ReturnType<typeof useAllMachines>, relayUrl: string): string {
    return `${machineName(proxy.machineId, machines)} · ${proxy.protocol}://${proxy.localHost}:${proxy.localPort}\n${relayUrl}`;
}

interface ProxyItemProps {
    proxy: PortProxyRecord;
    machines: ReturnType<typeof useAllMachines>;
    onRefresh: () => void;
    showDivider?: boolean;
}

const ProxyItem = React.memo(({ proxy, machines, onRefresh, showDivider = true }: ProxyItemProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const [busy, setBusy] = React.useState(false);
    const relayUrl = React.useMemo(() => buildPortProxyUrl(getServerUrl(), proxy), [proxy]);

    const handleCopy = React.useCallback(async () => {
        await Clipboard.setStringAsync(relayUrl);
        hapticsLight();
        showCopiedToast();
    }, [relayUrl]);

    const handleToggle = React.useCallback(async () => {
        if (!auth.credentials || busy) return;
        setBusy(true);
        try {
            await updatePortProxy(auth.credentials, proxy.id, { enabled: !proxy.enabled });
            onRefresh();
        } catch (error) {
            showToast(error instanceof Error ? error.message : t('portProxy.updateFailed'));
        } finally {
            setBusy(false);
        }
    }, [auth.credentials, busy, onRefresh, proxy.enabled, proxy.id]);

    const handleDelete = React.useCallback(async () => {
        if (!auth.credentials || busy) return;
        const confirmed = await Modal.confirm(
            t('portProxy.deleteTitle'),
            t('portProxy.deleteMessage', { name: proxy.name }),
            { confirmText: t('common.delete'), destructive: true }
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            await deletePortProxy(auth.credentials, proxy.id);
            onRefresh();
        } catch (error) {
            showToast(error instanceof Error ? error.message : t('portProxy.deleteFailed'));
        } finally {
            setBusy(false);
        }
    }, [auth.credentials, busy, onRefresh, proxy.id, proxy.name]);

    const statusColor = proxy.enabled ? theme.colors.status.connected : theme.colors.textSecondary;

    return (
        <Item
            title={proxy.name}
            subtitle={proxySubtitle(proxy, machines, relayUrl)}
            subtitleLines={2}
            leftElement={(
                <Ionicons
                    name="git-network-outline"
                    size={28}
                    color={statusColor}
                />
            )}
            rightElement={(
                <View style={styles.rowActions}>
                    <Pressable onPress={handleCopy} hitSlop={8}>
                        <Ionicons name="copy-outline" size={20} color={theme.colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={handleToggle} hitSlop={8} disabled={busy}>
                        {busy ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
                                <Text style={[styles.statusText, { color: statusColor }]}>
                                    {proxy.enabled ? t('portProxy.enabled') : t('portProxy.disabled')}
                                </Text>
                            </View>
                        )}
                    </Pressable>
                    <Pressable onPress={handleDelete} hitSlop={8}>
                        <Ionicons name="trash-outline" size={20} color={theme.colors.textDestructive} />
                    </Pressable>
                </View>
            )}
            onPress={() => router.push(`/port-proxy/${proxy.id}`)}
            showChevron={false}
            showDivider={showDivider}
            copy={relayUrl}
        />
    );
});

export const PortProxyView = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const machines = useAllMachines();
    const [proxies, setProxies] = React.useState<PortProxyRecord[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = React.useCallback(async (showRefresh = false) => {
        if (!auth.credentials) return;
        if (showRefresh) setRefreshing(true);
        setError(null);
        try {
            const result = await listPortProxies(auth.credentials);
            setProxies(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('portProxy.loadFailed'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [auth.credentials]);

    React.useEffect(() => {
        refresh(false);
    }, [refresh]);

    const handleAdd = React.useCallback(() => {
        router.push('/port-proxy/add');
    }, [router]);

    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyContainer}>
                    <ActivityIndicator size="large" color={theme.colors.textSecondary} />
                </View>
            </View>
        );
    }

    if (proxies.length === 0) {
        return (
            <View style={styles.container}>
                <ScrollView
                    contentContainerStyle={{ flexGrow: 1 }}
                    refreshControl={(
                        <RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} />
                    )}
                >
                <View style={styles.emptyContainer}>
                    <Image
                        source={require('@/assets/images/brutalist/Brutalism 117.png')}
                        contentFit="contain"
                        style={[{ width: 64, height: 64 }, styles.emptyIcon]}
                        tintColor={theme.colors.textSecondary}
                    />
                    <Text style={styles.emptyTitle}>{t('portProxy.emptyTitle')}</Text>
                    <Text style={styles.emptyDescription}>{t('portProxy.emptyDescription')}</Text>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <Pressable style={styles.addButton} onPress={error ? () => refresh(true) : handleAdd}>
                        <Text style={styles.addButtonText}>{error ? t('common.retry') : t('portProxy.addProxy')}</Text>
                    </Pressable>
                </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={(
                    <RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} />
                )}
            >
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                <ItemGroup title={t('portProxy.listTitle')} footer={t('portProxy.privateOnlyHint')}>
                    {proxies.map((proxy, index) => (
                        <ProxyItem
                            key={proxy.id}
                            proxy={proxy}
                            machines={machines}
                            onRefresh={() => refresh(false)}
                            showDivider={index < proxies.length - 1}
                        />
                    ))}
                </ItemGroup>
            </ScrollView>
        </View>
    );
});
