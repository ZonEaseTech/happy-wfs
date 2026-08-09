import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Message } from '@/sync/typesMessage';

/**
 * Vertical navigator rail for a session's own messages: one tick per user
 * message, hover shows a peek card with that message's text, click scrolls
 * the chat to it. Desktop-only affordance — phones have no hover and the
 * rail would eat horizontal space.
 */

const RAIL_WIDTH = 22;
const MAX_TICKS = 60;
const PEEK_MAX_CHARS = 220;

export interface RailEntry {
    /** Index inside the inverted chat list (0 = newest). */
    index: number;
    id: string;
    text: string;
}

export function buildRailEntries(messages: Message[]): RailEntry[] {
    const entries: RailEntry[] = [];
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.kind !== 'user-text') continue;
        const raw = (message.displayText ?? message.text ?? '').trim();
        if (!raw) continue;
        entries.push({ index: i, id: message.id, text: raw.slice(0, PEEK_MAX_CHARS) });
        if (entries.length >= MAX_TICKS) break;
    }
    return entries;
}

export const ChatMessageRail = React.memo(({ entries, onSelect }: {
    entries: RailEntry[];
    onSelect: (index: number) => void;
}) => {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState<RailEntry | null>(null);

    if (entries.length < 2) return null;

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: RAIL_WIDTH,
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 5,
            }}
        >
            <View style={{ gap: 6, alignItems: 'flex-start', paddingVertical: 12 }}>
                {entries.map((entry) => {
                    const active = hovered?.id === entry.id;
                    // Longer messages get a slightly wider tick, mirroring the
                    // rough shape of the conversation.
                    const width = Math.min(14, 6 + Math.round(entry.text.length / 30));
                    return (
                        <Pressable
                            key={entry.id}
                            onPress={() => onSelect(entry.index)}
                            onHoverIn={() => setHovered(entry)}
                            onHoverOut={() => setHovered((current) => (current?.id === entry.id ? null : current))}
                            hitSlop={4}
                            style={{ paddingVertical: 2 }}
                        >
                            <View style={{
                                width: active ? width + 6 : width,
                                height: 2,
                                borderRadius: 1,
                                backgroundColor: active ? theme.colors.textLink : theme.colors.divider,
                            }} />
                        </Pressable>
                    );
                })}
            </View>

            {hovered && (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: RAIL_WIDTH + 4,
                        maxWidth: 320,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        backgroundColor: theme.colors.surface,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        shadowColor: theme.colors.shadow.color,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: theme.colors.shadow.opacity,
                        shadowRadius: 10,
                        elevation: 6,
                    }}
                >
                    <Text
                        numberOfLines={4}
                        style={{ color: theme.colors.text, fontSize: 13, lineHeight: 19 }}
                    >
                        {hovered.text}
                    </Text>
                </View>
            )}
        </View>
    );
});

export const RAIL_SUPPORTED = Platform.OS === 'web';
