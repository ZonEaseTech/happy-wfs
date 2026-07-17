import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { unpinSessionGoal, useSessionGoalPin } from '@/sync/sessionGoalPin';

/**
 * Floating banner under the chat header showing the message the user pinned
 * as this session's goal. Collapsed to 2 lines; tap toggles full text.
 */
export const SessionGoalPinBanner = React.memo(({ sessionId }: { sessionId: string }) => {
    const { theme } = useUnistyles();
    const pin = useSessionGoalPin(sessionId);
    const [expanded, setExpanded] = React.useState(false);

    if (!pin) return null;

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginHorizontal: 12,
                marginTop: 6,
                paddingVertical: 8,
                paddingLeft: 12,
                paddingRight: 6,
                borderRadius: 12,
                backgroundColor: theme.colors.surfaceHigh,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                shadowColor: theme.colors.shadow.color,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: theme.colors.shadow.opacity,
                shadowRadius: 4,
                elevation: 3,
                ...(Platform.OS === 'web' ? { maxWidth: 700, alignSelf: 'center', width: '100%' } as const : null),
            }}
        >
            <Ionicons
                name="pin"
                size={15}
                color={theme.colors.textSecondary}
                style={{ marginTop: 2, marginRight: 8 }}
            />
            <Pressable
                style={{ flex: 1 }}
                onPress={() => setExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={t('sessionGoalPin.pinAction')}
            >
                <Text
                    style={{ color: theme.colors.text, fontSize: 13, lineHeight: 18 }}
                    numberOfLines={expanded ? undefined : 2}
                >
                    {pin.text}
                </Text>
            </Pressable>
            <Pressable
                onPress={() => unpinSessionGoal(sessionId)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('sessionGoalPin.unpinAction')}
                style={{ padding: 4, marginLeft: 4 }}
            >
                <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
});
