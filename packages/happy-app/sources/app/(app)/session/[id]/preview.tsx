import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { consumePreviewHtml } from '@/components/tools/previewHtmlStore';
import { StyleSheet } from 'react-native-unistyles';
import { DesktopModalShell } from '@/components/DesktopModalShell';

const WebView = require('react-native-webview').default;

export default React.memo(() => {
    const router = useRouter();
    const { html } = React.useMemo(() => consumePreviewHtml(), []);

    if (!html) {
        router.back();
        return null;
    }

    return (
        <DesktopModalShell title="Preview">
            <View style={styles.container}>
                <WebView
                    source={{ html }}
                    style={styles.webview}
                    originWhitelist={['*']}
                    javaScriptEnabled={true}
                    scrollEnabled={true}
                />
            </View>
        </DesktopModalShell>
    );
});

const styles = StyleSheet.create((_theme) => ({
    container: {
        flex: 1,
    },
    webview: {
        flex: 1,
    },
}));
