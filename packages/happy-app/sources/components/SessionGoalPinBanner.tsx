import * as React from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { unpinSessionGoal, useSessionGoalPins } from '@/sync/sessionGoalPin';

/**
 * Card under the chat header listing the messages the user pinned as this
 * session's goals. Not floating: the parent shifts chat content down by the
 * height reported through onHeightChange, so nothing is covered. Collapsed
 * to two lines per pin; the label row toggles full text so the body text
 * itself stays free for text selection / copy.
 */
export const SessionGoalPinBanner = React.memo(({ sessionId, onHeightChange }: {
    sessionId: string;
    onHeightChange?: (height: number) => void;
}) => {
    const { theme } = useUnistyles();
    const pins = useSessionGoalPins(sessionId);
    const [expanded, setExpanded] = React.useState(false);

    const hasPins = pins.length > 0;
    React.useEffect(() => {
        if (!hasPins) onHeightChange?.(0);
    }, [hasPins, onHeightChange]);
    const handleLayout = React.useCallback((e: LayoutChangeEvent) => {
        onHeightChange?.(e.nativeEvent.layout.height);
    }, [onHeightChange]);

    if (!hasPins) return null;

    const accent = theme.colors.textLink;
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
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable
                        onPress={() => setExpanded((v) => !v)}
                        accessibilityRole="button"
                        accessibilityLabel={t('sessionGoalPin.pinAction')}
                        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2, alignSelf: 'flex-start' }}
                    >
                        <Text style={{ color: accent, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 }}>
                            {t('sessionGoalPin.goalLabel')}{pins.length > 1 ? ` · ${pins.length}` : ''}
                        </Text>
                        <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={11}
                            color={accent}
                            style={{ marginLeft: 3 }}
                        />
                    </Pressable>
                    {pins.map((pin, index) => (
                        <View
                            key={pin.messageId}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'flex-start',
                                ...(index > 0 ? {
                                    marginTop: 6,
                                    paddingTop: 6,
                                    borderTopWidth: 1,
                                    borderTopColor: theme.colors.divider,
                                } : null),
                            }}
                        >
                            <Text
                                selectable
                                style={{ flex: 1, color: theme.colors.text, fontSize: 13, lineHeight: 19 }}
                                numberOfLines={expanded ? undefined : 2}
                            >
                                {pin.text}
                            </Text>
                            <Pressable
                                onPress={() => unpinSessionGoal(sessionId, pin.messageId)}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={t('sessionGoalPin.unpinAction')}
                                style={{ padding: 2, marginLeft: 8 }}
                            >
                                <Ionicons name="close" size={15} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
});
