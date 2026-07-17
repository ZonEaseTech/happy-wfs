import * as React from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { unpinSessionGoal, useSessionGoalPin } from '@/sync/sessionGoalPin';

/**
 * Header-extension strip showing the message the user pinned as this
 * session's goal. Not floating: the parent shifts chat content down by the
 * height reported through onHeightChange, so nothing is covered. Collapsed
 * to a single ellipsized line; tap toggles full text.
 */
export const SessionGoalPinBanner = React.memo(({ sessionId, onHeightChange }: {
    sessionId: string;
    onHeightChange?: (height: number) => void;
}) => {
    const { theme } = useUnistyles();
    const pin = useSessionGoalPin(sessionId);
    const [expanded, setExpanded] = React.useState(false);

    const hasPin = !!pin;
    React.useEffect(() => {
        if (!hasPin) onHeightChange?.(0);
    }, [hasPin, onHeightChange]);
    const handleLayout = React.useCallback((e: LayoutChangeEvent) => {
        onHeightChange?.(e.nativeEvent.layout.height);
    }, [onHeightChange]);

    if (!pin) return null;

    const accent = theme.colors.button.primary.background;
    return (
        <View
            onLayout={handleLayout}
            style={{
                flexDirection: 'row',
                alignItems: expanded ? 'flex-start' : 'center',
                paddingHorizontal: 16,
                paddingVertical: 8,
                backgroundColor: theme.colors.surfaceHigh,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
            }}
        >
            <Ionicons
                name="pin"
                size={13}
                color={accent}
                style={{ marginRight: 8, marginTop: expanded ? 3 : 0 }}
            />
            <Pressable
                style={{ flex: 1, minWidth: 0 }}
                onPress={() => setExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={t('sessionGoalPin.pinAction')}
            >
                <Text
                    style={{ color: theme.colors.textSecondary, fontSize: 12.5, lineHeight: 18 }}
                    numberOfLines={expanded ? undefined : 1}
                >
                    <Text style={{ color: accent, fontWeight: '600' }}>{t('sessionGoalPin.goalLabel')}  </Text>
                    {pin.text}
                </Text>
            </Pressable>
            <Pressable
                onPress={() => unpinSessionGoal(sessionId)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('sessionGoalPin.unpinAction')}
                style={{ padding: 2, marginLeft: 8 }}
            >
                <Ionicons name="close" size={15} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
});
