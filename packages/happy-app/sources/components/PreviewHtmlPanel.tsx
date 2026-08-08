import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { getPreviewHtmlVersion, peekPreviewHtml, subscribePreviewHtml } from '@/components/tools/previewHtmlStore';

/**
 * Preview surface: iframe on web, WebView on native. react-native-webview
 * must NOT be required at module load — it throws on web and would take the
 * whole session screen down with it.
 */
function PreviewSurface({ html }: { html: string }) {
    if (Platform.OS === 'web') {
        return (
            // @ts-ignore iframe is a web-only DOM element.
            <iframe
                title="Preview"
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
            style={{ flex: 1 }}
            originWhitelist={['*']}
            javaScriptEnabled
            scrollEnabled
        />
    );
}

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
            <PreviewSurface html={html} />
        </View>
    );
});

/**
 * In-chat-column overlay: covers the chat/input area only, so the session
 * header and any terminal / right panels stay visible.
 */
export const ChatPreviewOverlay = React.memo(({ onClose }: { onClose: () => void }) => {
    const { theme } = useUnistyles();
    React.useSyncExternalStore(subscribePreviewHtml, getPreviewHtmlVersion, getPreviewHtmlVersion);
    const { title } = peekPreviewHtml();

    return (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.surface, zIndex: 20 }}>
            <View style={{
                height: 44,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 12,
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
            }}>
                <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
                </Pressable>
                <Ionicons name="earth-outline" size={16} color={theme.colors.textSecondary} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                    {title?.trim() || 'Preview Html'}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <Ionicons name="close" size={20} color={theme.colors.text} />
                </Pressable>
            </View>
            <PreviewHtmlPanel />
        </View>
    );
});
