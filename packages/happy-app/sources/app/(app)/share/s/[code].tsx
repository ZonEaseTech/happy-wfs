import * as React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { fetchPublicShareLink } from '@/sync/apiShareLinks';
import { PublicHtmlPreviewView } from '../html';

export default function PublicShareShortLinkScreen() {
    const params = useLocalSearchParams<{ code?: string }>();
    const { theme } = useUnistyles();
    const code = typeof params.code === 'string' ? params.code : '';
    const [link, setLink] = React.useState<{ url: string; title: string | null } | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        setLink(null);
        setError(null);
        if (!code) {
            setError('Invalid share link.');
            return;
        }
        fetchPublicShareLink(code)
            .then((resolved) => { if (!cancelled) setLink(resolved); })
            .catch(() => { if (!cancelled) setError('Share link not found or expired.'); });
        return () => { cancelled = true; };
    }, [code]);

    if (link) {
        return <PublicHtmlPreviewView url={link.url} title={link.title?.trim() || 'Preview Html'} />;
    }

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.colors.surface }}>
            <Stack.Screen options={{ headerShown: false, title: 'Preview Html' }} />
            {error ? (
                <>
                    <Ionicons name="warning-outline" size={36} color={theme.colors.textDestructive} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{error}</Text>
                </>
            ) : (
                <>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>Loading preview...</Text>
                </>
            )}
        </View>
    );
}
