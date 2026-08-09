import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Message } from '@/sync/typesMessage';

/**
 * Vertical navigator rail for a session's own messages: one tick per user
 * message. Hovering anywhere over the rail expands every tick (so the shape
 * of the conversation becomes readable); hovering a single tick shows a peek
 * card with that message and the reply it got, and clicking scrolls to it.
 * Desktop-only affordance — phones have no hover.
 */

const RAIL_WIDTH = 64;
const MAX_TICKS = 80;
const PEEK_MAX_CHARS = 260;
const TICK_SLOT_HEIGHT = 11;
const PEEK_CARD_WIDTH = 460;

export interface RailEntry {
    /** Index inside the inverted chat list (0 = newest). */
    index: number;
    id: string;
    text: string;
    reply: string | null;
}

/**
 * Harness-injected messages (task notifications, system reminders, command
 * output) arrive as user messages but are not things the user typed, so they
 * must not become navigator ticks.
 */
const SYSTEM_NOISE_PREFIXES = [
    '<task-notification>',
    '<system-reminder>',
    '[SYSTEM NOTIFICATION',
    '<local-command-stdout>',
    '<command-name>',
    '<user-prompt-submit-hook>',
    'Caveat: The messages below were generated',
];

function isSystemNoise(text: string): boolean {
    return SYSTEM_NOISE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function messageText(message: Message): string {
    if (message.kind === 'user-text') return (message.displayText ?? message.text ?? '').trim();
    if (message.kind === 'agent-text') return (message.text ?? '').trim();
    return '';
}

export function buildRailEntries(messages: Message[]): RailEntry[] {
    const entries: RailEntry[] = [];
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.kind !== 'user-text') continue;
        const text = messageText(message);
        if (!text || isSystemNoise(text)) continue;
        // The reply lives at a *newer* index in the inverted list.
        let reply: string | null = null;
        for (let j = i - 1; j >= 0 && j >= i - 12; j--) {
            if (messages[j].kind === 'agent-text') {
                const replyText = messageText(messages[j]);
                if (replyText) {
                    reply = replyText.slice(0, PEEK_MAX_CHARS);
                    break;
                }
            }
        }
        entries.push({ index: i, id: message.id, text: text.slice(0, PEEK_MAX_CHARS), reply });
        if (entries.length >= MAX_TICKS) break;
    }
    // Messages arrive newest-first (inverted list); the rail reads top-down
    // like the chat, so the newest tick belongs at the bottom.
    return entries.reverse();
}

export const ChatMessageRail = React.memo(({ entries, onSelect, onPreload }: {
    entries: RailEntry[];
    onSelect: (index: number) => void;
    onPreload?: () => void;
}) => {
    const { theme } = useUnistyles();
    const [railHovered, setRailHovered] = React.useState(false);
    const [hovered, setHovered] = React.useState<{ entry: RailEntry; y: number } | null>(null);

    if (entries.length === 0) return null;

    return (
        <Pressable
            onHoverIn={() => { setRailHovered(true); onPreload?.(); }}
            onHoverOut={() => { setRailHovered(false); setHovered(null); }}
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: RAIL_WIDTH,
                justifyContent: 'center',
                alignItems: 'flex-start',
                paddingLeft: 8,
                zIndex: 5,
            }}
        >
            <View style={{ alignItems: 'flex-start' }}>
                {hovered && (
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            left: RAIL_WIDTH,
                            top: hovered.y - 20,
                            width: PEEK_CARD_WIDTH,
                            paddingVertical: 12,
                            paddingHorizontal: 16,
                            borderRadius: 14,
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                            shadowColor: theme.colors.shadow.color,
                            shadowOffset: { width: 0, height: 6 },
                            shadowOpacity: theme.colors.shadow.opacity,
                            shadowRadius: 14,
                            elevation: 8,
                            zIndex: 10,
                        }}
                    >
                        <Text
                            numberOfLines={1}
                            style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 }}
                        >
                            {hovered.entry.text}
                        </Text>
                        {hovered.entry.reply && (
                            <Text
                                numberOfLines={3}
                                style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 }}
                            >
                                {hovered.entry.reply}
                            </Text>
                        )}
                    </View>
                )}
                {entries.map((entry, position) => {
                    const active = hovered?.entry.id === entry.id;
                    // Collapsed: uniform short ticks. Hovered rail: length maps
                    // to message length so the conversation shape shows.
                    const expanded = 14 + Math.min(38, Math.round(entry.text.length / 4));
                    const width = railHovered ? expanded : 6;
                    return (
                        <Pressable
                            key={entry.id}
                            onPress={() => onSelect(entry.index)}
                            onHoverIn={() => setHovered({ entry, y: position * TICK_SLOT_HEIGHT })}
                            hitSlop={{ top: 3, bottom: 3, left: 6, right: 10 }}
                            style={{ height: TICK_SLOT_HEIGHT, justifyContent: 'center' }}
                        >
                            <View style={{
                                width,
                                height: 2,
                                borderRadius: 1,
                                backgroundColor: active ? theme.colors.textLink : theme.colors.divider,
                            }} />
                        </Pressable>
                    );
                })}
            </View>

        </Pressable>
    );
});

export const RAIL_SUPPORTED = Platform.OS === 'web';
