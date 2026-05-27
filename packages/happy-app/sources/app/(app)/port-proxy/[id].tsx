import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { PortProxyForm } from '@/components/PortProxyForm';
import { useAuth } from '@/auth/AuthContext';
import { listPortProxies, type PortProxyRecord } from '@/sync/apiPortProxy';
import { t } from '@/text';

export default React.memo(function EditPortProxyPage() {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    const proxyId = Array.isArray(id) ? id[0] : id;
    const auth = useAuth();
    const { theme } = useUnistyles();
    const [proxy, setProxy] = React.useState<PortProxyRecord | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!auth.credentials || !proxyId) return;
            try {
                const proxies = await listPortProxies(auth.credentials);
                if (cancelled) return;
                setProxy(proxies.find((item) => item.id === proxyId) ?? null);
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : t('portProxy.loadFailed'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [auth.credentials, proxyId]);

    if (loading) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.groupped.background }}>
                <ActivityIndicator color={theme.colors.textSecondary} />
            </View>
        );
    }

    if (error || !proxy) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.colors.groupped.background }}>
                <Text style={{ color: error ? theme.colors.textDestructive : theme.colors.textSecondary }}>
                    {error || t('portProxy.notFound')}
                </Text>
            </View>
        );
    }

    return <PortProxyForm mode="edit" initialProxy={proxy} />;
});
