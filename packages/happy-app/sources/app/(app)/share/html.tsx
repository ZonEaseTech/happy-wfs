import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { isAllowedPublicHtmlPreviewSourceUrl } from '@/utils/publicHtmlPreviewShare';

function PublicHtmlWebView({ html, title }: { html: string; title: string }) {
    if (Platform.OS === 'web') {
        return (
            // @ts-ignore iframe is a web-only DOM element.
            <iframe
                title={title}
                srcDoc={html}
                sandbox="allow-forms allow-modals allow-popups allow-scripts"
                style={{ border: '0', width: '100%', height: '100%', backgroundColor: 'white' }}
            />
        );
    }

    const WebView = require('react-native-webview').default;
    return (
        <WebView
            source={{ html }}
            style={{ flex: 1, backgroundColor: 'white' }}
            originWhitelist={['*']}
            javaScriptEnabled
        />
    );
}

export default function PublicHtmlPreviewScreen() {
    const params = useLocalSearchParams<{ url?: string; title?: string }>();
    const { theme } = useUnistyles();
    const url = typeof params.url === 'string' ? params.url : '';
    const title = (typeof params.title === 'string' && params.title.trim()) ? params.title.trim() : 'Preview Html';
    const [html, setHtml] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const controller = new AbortController();
        setHtml(null);
        setError(null);

        if (!isAllowedPublicHtmlPreviewSourceUrl(url)) {
            setError('Invalid or unsupported preview link.');
            return () => controller.abort();
        }

        fetch(url, { signal: controller.signal, cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load preview: ${response.status}`);
                }
                setHtml(await response.text());
            })
            .catch((nextError) => {
                if (controller.signal.aborted) return;
                setError(nextError instanceof Error ? nextError.message : 'Failed to load preview.');
            });

        return () => controller.abort();
    }, [url]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <Stack.Screen options={{ headerShown: false, title }} />
            <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.headerTitleWrap}>
                    <Ionicons name="globe-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
                </View>
                <Pressable
                    onPress={() => window.open(url, '_blank')}
                    disabled={Platform.OS !== 'web' || !url}
                    style={({ pressed }) => [styles.openSourceButton, { opacity: pressed ? 0.65 : 1 }]}
                    accessibilityLabel="Open source"
                >
                    <Ionicons name="open-outline" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
            {error ? (
                <View style={styles.center}>
                    <Ionicons name="warning-outline" size={36} color={theme.colors.textDestructive} />
                    <Text style={[styles.statusTitle, { color: theme.colors.textDestructive }]}>Error</Text>
                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>{error}</Text>
                </View>
            ) : html ? (
                <View style={styles.preview}>
                    <PublicHtmlWebView html={html} title={title} />
                </View>
            ) : (
                <View style={styles.center}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>Loading preview...</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        minHeight: 0,
    },
    header: {
        minHeight: 54,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    headerTitleWrap: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        flex: 1,
        minWidth: 0,
    },
    openSourceButton: {
        padding: 8,
        borderRadius: 10,
    },
    preview: {
        flex: 1,
        minHeight: 0,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 10,
    },
    statusTitle: {
        ...Typography.default('semiBold'),
        fontSize: 18,
    },
    statusText: {
        ...Typography.default(),
        fontSize: 15,
        textAlign: 'center',
    },
}));
