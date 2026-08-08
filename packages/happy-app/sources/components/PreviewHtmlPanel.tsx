import * as React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { getPreviewHtmlVersion, peekPreviewHtml, subscribePreviewHtml } from '@/components/tools/previewHtmlStore';

const WebView = require('react-native-webview').default;

/**
 * Right-panel embedding of a Preview Html tool result. Reads the module
 * store non-destructively so the panel survives re-renders; SessionView
 * switches the panel type here when a preview card is pressed in desktop
 * panel mode.
 */
export const PreviewHtmlPanel = React.memo(() => {
    const { theme } = useUnistyles();
    // Re-render when another preview card is pressed while the panel is open.
    React.useSyncExternalStore(subscribePreviewHtml, getPreviewHtmlVersion, getPreviewHtmlVersion);
    const { html } = peekPreviewHtml();

    if (!html) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>No preview</Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
            <WebView
                source={{ html }}
                style={{ flex: 1 }}
                originWhitelist={['*']}
                javaScriptEnabled
                scrollEnabled
            />
        </View>
    );
});
