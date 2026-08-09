import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Deferred } from '@/components/Deferred';
import { ToolFullView } from '@/components/tools/ToolFullView';
import { ToolHeader } from '@/components/tools/ToolHeader';
import { ToolStatusIndicator } from '@/components/tools/ToolStatusIndicator';
import { useMessage, useSession } from '@/sync/storage';

/**
 * Desktop-panel replacement for navigating to the tool detail route: hosts
 * the exact same ToolFullView (share / copy / open-in-tab actions included)
 * inside the chat column, so the terminal and right panels stay visible and
 * closing simply returns to the chat without touching navigation history.
 */
export const ChatToolOverlay = React.memo(({ sessionId, messageId, onClose }: {
    sessionId: string;
    messageId: string;
    onClose: () => void;
}) => {
    const { theme } = useUnistyles();
    const session = useSession(sessionId);
    const message = useMessage(sessionId, messageId);

    React.useEffect(() => {
        if (!message) onClose();
    }, [message, onClose]);

    if (!message || message.kind !== 'tool-call' || !message.tool) {
        return null;
    }

    return (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.surface, zIndex: 20 }}>
            <View style={{
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 8,
                gap: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.header.background,
            }}>
                <Pressable onPress={onClose} hitSlop={10} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Ionicons
                        name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                        size={24}
                        color={theme.colors.header.tint}
                    />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                    <ToolHeader tool={message.tool} />
                </View>
                <ToolStatusIndicator tool={message.tool} />
                <Pressable onPress={onClose} hitSlop={10} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Ionicons name="close" size={22} color={theme.colors.header.tint} />
                </Pressable>
            </View>
            <Deferred>
                <ToolFullView tool={message.tool} metadata={session?.metadata ?? null} messages={message.children} />
            </Deferred>
        </View>
    );
});
