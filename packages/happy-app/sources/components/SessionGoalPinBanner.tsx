import * as React from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { unpinSessionGoal, useSessionGoalPin } from '@/sync/sessionGoalPin';

/**
 * Card under the chat header showing the message the user pinned as this
 * session's goal. Not floating: the parent shifts chat content down by the
 * height reported through onHeightChange, so nothing is covered. Collapsed
 * to two lines; tap toggles full text.
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
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingTop: 8,
            }}
        >
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    width: '100%',
                    maxWidth: layout.maxWidth,
                    paddingVertical: 10,
                    paddingLeft: 12,
                    paddingRight: 8,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                    borderLeftWidth: 3,
                    borderLeftColor: accent,
                    borderRadius: 12,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 6,
                    elevation: 3,
                }}
            >
                <View
                    style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        backgroundColor: theme.colors.surfaceHigh,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 10,
                    }}
                >
                    <Ionicons name="pin" size={14} color={accent} />
                </View>
                <Pressable
                    style={{ flex: 1, minWidth: 0 }}
                    onPress={() => setExpanded((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionGoalPin.pinAction')}
                >
                    <Text style={{ color: accent, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, marginBottom: 2 }}>
                        {t('sessionGoalPin.goalLabel')}
                    </Text>
                    <Text
                        style={{ color: theme.colors.text, fontSize: 13, lineHeight: 19 }}
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
        </View>
    );
});
