/**
 * OpenClaw Chat Page
 *
 * Chat view for an OpenClaw session.
 * Handles message display, input, and real-time streaming.
 *
 * Uses a single messages list approach:
 * - User messages are added directly to the list with status tracking
 * - Streaming AI responses are managed as a temporary message in the list
 * - On completion, the entire list is replaced with server history (single atomic update)
 */

import React from 'react';
import {
    View,
    Text,
    FlatList,
    Pressable,
    ActivityIndicator,
    Platform,
    useWindowDimensions,
    Animated,
    Easing,
} from 'react-native';
import { AgentContentView } from '@/components/AgentContentView';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { MultiTextInput, KeyPressEvent } from '@/components/MultiTextInput';
import { useOpenClawConnection } from '@/openclaw/connection';
import { useOpenClawMachine } from '@/sync/storage';
import type { OpenClawChatMessage, OpenClawChatEvent, OpenClawContentBlock, OpenClawToolStreamEvent } from '@/openclaw/types';

// Header button width constants
const HEADER_BUTTON_WIDTH = 40; // 24px icon + 16px padding
const HEADER_PADDING = Platform.OS === 'ios' ? 16 : 32;
const HEADER_CENTER_PADDING = 24;

// Special ID for streaming message
const STREAMING_MESSAGE_ID = '__streaming__';

// Local message type with status tracking
type MessageStatus = 'sending' | 'sent' | 'failed';

interface LocalMessage extends OpenClawChatMessage {
    localId: string;
    status?: MessageStatus;
    isStreaming?: boolean;
    errorMessage?: string;
    activeToolCalls?: Record<string, { name: string; status: 'running' | 'completed' | 'failed' }>;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    messageList: {
        flex: 1,
    },
    messageListContent: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        rowGap: 12,
    },
    messageBubble: {
        flexShrink: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 16,
    },
    userBubble: {
        backgroundColor: theme.colors.button.primary.background,
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        backgroundColor: theme.colors.surfacePressed,
        borderBottomLeftRadius: 4,
    },
    messageText: {
        fontSize: 16,
        lineHeight: 22,
        ...Typography.default(),
    },
    userMessageText: {
        color: theme.colors.button.primary.tint,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
    inputInner: {
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    inputPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    inputWrapper: {
        flex: 1,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonDisabled: {
        backgroundColor: theme.colors.surfacePressed,
    },
    messageRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        maxWidth: '85%',
    },
    messageRowUser: {
        alignSelf: 'flex-end',
    },
    messageRowAssistant: {
        alignSelf: 'flex-start',
    },
    statusContainer: {
        width: 28,
        height: 30,
        marginTop: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyTitle: {
        fontSize: 18,
        color: theme.colors.text,
        marginBottom: 8,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptyDescription: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    readingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 6,
        gap: 4,
    },
    readingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.textSecondary,
    },
    // Typing indicator for streaming messages - inside bubble at bottom right
    typingIndicator: {
        position: 'absolute',
        right: 8,
        bottom: 6,
    },
}));

// Animated dot component for smooth animations (used in ReadingIndicator)
const AnimatedDot = React.memo(({ delay }: { delay: number }) => {
    const opacity = React.useRef(new Animated.Value(0.3)).current;

    React.useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.delay(delay),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 300,
                    easing: Easing.ease,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.3,
                    duration: 300,
                    easing: Easing.ease,
                    useNativeDriver: true,
                }),
                Animated.delay(600 - delay),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, [opacity, delay]);

    return (
        <Animated.View style={[styles.readingDot, { opacity }]} />
    );
});

// Reading indicator with animated dots (used when waiting for first content)
const ReadingIndicator = React.memo(() => {
    return (
        <View style={[styles.messageRow, styles.messageRowAssistant]}>
            <View style={[styles.messageBubble, styles.assistantBubble]}>
                <View style={styles.readingIndicator}>
                    <AnimatedDot delay={0} />
                    <AnimatedDot delay={200} />
                    <AnimatedDot delay={400} />
                </View>
            </View>
        </View>
    );
});

// Typing indicator shown at the end of streaming messages
const TypingIndicator = React.memo(() => {
    const { theme } = useUnistyles();
    return (
        <View style={styles.typingIndicator}>
            <ActivityIndicator size={14} color={theme.colors.textSecondary} />
        </View>
    );
});

// Collapsible thinking block
const ThinkingBlock = React.memo(({ thinking }: { thinking: string }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const preview = thinking.length > 50 ? thinking.slice(0, 50) + '...' : thinking;

    return (
        <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={{
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 8,
                padding: 8,
                marginBottom: 4,
                opacity: 0.8,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                    {'\ud83d\udcad ' + t('openclaw.thinking')}
                </Text>
                {!expanded && (
                    <Text
                        numberOfLines={1}
                        style={{ fontSize: 12, color: theme.colors.textSecondary, flex: 1, ...Typography.default() }}
                    >
                        {preview}
                    </Text>
                )}
                <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                    {expanded ? '\u25bc' : '\u25b6'}
                </Text>
            </View>
            {expanded && (
                <View style={{ marginTop: 6 }}>
                    <MarkdownView markdown={thinking} />
                </View>
            )}
        </Pressable>
    );
});

// One-line tool call summary, optionally paired with a result
const ToolCallSummary = React.memo(({ name, args, resultStatus }: {
    name?: string;
    args?: unknown;
    resultStatus?: 'completed' | 'failed' | 'running' | null;
}) => {
    const { theme } = useUnistyles();
    const toolName = name ?? t('openclaw.toolCall');

    let argSummary = '';
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        const entries = Object.entries(args as Record<string, unknown>);
        if (entries.length > 0) {
            const [, value] = entries[0];
            const raw = typeof value === 'string' ? value : JSON.stringify(value);
            argSummary = raw.length > 40 ? raw.slice(0, 40) + '...' : raw;
        }
    }

    const statusLabel = resultStatus === 'completed' ? t('openclaw.toolCompleted')
        : resultStatus === 'failed' ? t('openclaw.toolFailed')
        : resultStatus === 'running' ? t('openclaw.toolRunning')
        : '';

    const statusColor = resultStatus === 'failed'
        ? theme.colors.status.disconnected
        : theme.colors.textSecondary;

    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 3,
            gap: 4,
        }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                {'\ud83d\udd27 ' + toolName}
            </Text>
            {argSummary ? (
                <Text
                    numberOfLines={1}
                    style={{ fontSize: 13, color: theme.colors.textSecondary, flex: 1, ...Typography.default() }}
                >
                    {'\u00b7 ' + argSummary}
                </Text>
            ) : null}
            {statusLabel ? (
                <Text style={{ fontSize: 13, color: statusColor, marginLeft: 'auto' }}>
                    {statusLabel}
                </Text>
            ) : null}
        </View>
    );
});

// Standalone tool result (when no matching toolcall exists)
const ToolResultSummary = React.memo(({ name, isError }: {
    name?: string;
    isError?: boolean;
}) => {
    const { theme } = useUnistyles();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 4 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                {'\ud83d\udccb ' + t('openclaw.toolResult')}
                {name ? ` \u00b7 ${name}` : ''}
            </Text>
            <Text style={{
                fontSize: 13,
                color: isError ? theme.colors.status.disconnected : theme.colors.textSecondary,
                marginLeft: 'auto',
            }}>
                {isError ? '\u2717' : '\u2713'}
            </Text>
        </View>
    );
});

// Inline image from base64 data
const ImageBlock = React.memo(({ data, mimeType }: { data?: string; mimeType?: string }) => {
    const { theme } = useUnistyles();
    if (!data || !mimeType) {
        return (
            <View style={{
                padding: 12,
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 8,
                alignItems: 'center',
            }}>
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                    {t('openclaw.imageUnavailable')}
                </Text>
            </View>
        );
    }
    return (
        <Image
            source={{ uri: `data:${mimeType};base64,${data}` }}
            contentFit="contain"
            style={{
                width: '100%',
                aspectRatio: 1,
                maxHeight: 300,
                borderRadius: 8,
            }}
        />
    );
});

// Build renderable block list from message content, pairing toolcall with tool_result
function buildAssistantBlocks(
    content: OpenClawContentBlock[],
    phase?: 'commentary' | 'final_answer',
    activeToolCalls?: Record<string, { name: string; status: 'running' | 'completed' | 'failed' }>,
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];

    // Build a map of tool_result by id for pairing
    const resultMap = new Map<string, { is_error?: boolean }>();
    for (const block of content) {
        if (block.type === 'tool_result' && block.id) {
            resultMap.set(block.id, { is_error: block.is_error });
        }
    }

    const pairedResultIds = new Set<string>();
    const hasFinalAnswer = phase === 'final_answer';

    for (let i = 0; i < content.length; i++) {
        const block = content[i];

        switch (block.type) {
            case 'text':
                if (hasFinalAnswer || !phase) {
                    if (block.text.trim()) {
                        nodes.push(<MarkdownView key={`text-${i}`} markdown={block.text} />);
                    }
                }
                break;

            case 'thinking':
                if (block.thinking.trim()) {
                    nodes.push(<ThinkingBlock key={`thinking-${i}`} thinking={block.thinking} />);
                }
                break;

            case 'toolcall': {
                const result = block.id ? resultMap.get(block.id) : undefined;
                if (block.id && result) {
                    pairedResultIds.add(block.id);
                }
                const liveStatus = block.id ? activeToolCalls?.[block.id]?.status : undefined;
                const resultStatus = result
                    ? (result.is_error ? 'failed' as const : 'completed' as const)
                    : (liveStatus ?? null);
                nodes.push(
                    <ToolCallSummary
                        key={`tool-${i}`}
                        name={block.name}
                        args={block.arguments}
                        resultStatus={resultStatus}
                    />
                );
                break;
            }

            case 'tool_result':
                if (!block.id || !pairedResultIds.has(block.id)) {
                    nodes.push(
                        <ToolResultSummary
                            key={`result-${i}`}
                            name={block.name}
                            isError={block.is_error}
                        />
                    );
                }
                break;

            case 'image':
                nodes.push(<ImageBlock key={`img-${i}`} data={block.data} mimeType={block.mimeType} />);
                break;
        }
    }

    // Append live tool calls not yet in content blocks
    if (activeToolCalls) {
        for (const [id, tool] of Object.entries(activeToolCalls)) {
            if (!content.some((b) => b.type === 'toolcall' && b.id === id)) {
                nodes.push(
                    <ToolCallSummary
                        key={`live-tool-${id}`}
                        name={tool.name}
                        resultStatus={tool.status}
                    />
                );
            }
        }
    }

    return nodes;
}

interface MessageItemProps {
    message: LocalMessage;
    onRetry?: (localId: string) => void;
}

const MessageItem = React.memo(({ message, onRetry }: MessageItemProps) => {
    const { theme } = useUnistyles();
    const isUser = message.role === 'user';
    const isFailed = message.status === 'failed';
    const isSending = message.status === 'sending';
    const isStreaming = message.isStreaming;

    const getTextContent = (): string => {
        if (typeof message.content === 'string') return message.content;
        return message.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && 'text' in block && typeof (block as { text?: unknown }).text === 'string')
            .map((block) => block.text)
            .join('\n');
    };

    const renderAssistantContent = () => {
        if (typeof message.content === 'string') {
            if (!message.content.trim()) return null;
            return <MarkdownView markdown={message.content} />;
        }

        const blocks = buildAssistantBlocks(
            message.content,
            message.phase,
            message.activeToolCalls,
        );

        if (blocks.length === 0 && !isStreaming) return null;
        return <>{blocks}</>;
    };

    if (isStreaming) {
        const hasContent = typeof message.content === 'string'
            ? message.content.trim().length > 0
            : message.content.length > 0;
        if (!hasContent && !message.activeToolCalls) {
            return <ReadingIndicator />;
        }
    }

    const renderStatusIndicator = () => {
        if (!isUser) return null;
        if (isSending) {
            return (
                <View style={styles.statusContainer}>
                    <ActivityIndicator size={14} color={theme.colors.textSecondary} />
                </View>
            );
        }
        if (isFailed) {
            return (
                <Pressable
                    style={styles.statusContainer}
                    onPress={() => onRetry?.(message.localId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="alert-circle" size={20} color={theme.colors.status.disconnected} />
                </Pressable>
            );
        }
        return null;
    };

    if (isUser) {
        const textContent = getTextContent();
        return (
            <View style={[styles.messageRow, styles.messageRowUser]}>
                {renderStatusIndicator()}
                <View style={[styles.messageBubble, styles.userBubble, isFailed && { opacity: 0.7 }]}>
                    <Text style={[styles.messageText, styles.userMessageText]}>
                        {textContent}
                    </Text>
                </View>
            </View>
        );
    }

    const assistantContent = renderAssistantContent();
    if (!assistantContent && !isStreaming) return null;

    return (
        <View style={[styles.messageRow, styles.messageRowAssistant]}>
            <View style={[styles.messageBubble, styles.assistantBubble, { gap: 4 }]}>
                {assistantContent}
                {isStreaming && <TypingIndicator />}
            </View>
        </View>
    );
});

export default function OpenClawChatPage() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const { machineId, sessionKey, sessionName: sessionNameParam } = useLocalSearchParams<{
        machineId: string;
        sessionKey: string;
        sessionName?: string;
    }>();

    // Left: back button (1), Right: loading indicator (1)
    const headerTitleMaxWidth = screenWidth - (HEADER_BUTTON_WIDTH * 2) - HEADER_PADDING - HEADER_CENTER_PADDING;

    // Get machine data
    const machine = useOpenClawMachine(machineId ?? '');

    // Ref for handling chat events - must be before useOpenClawConnection
    const handleChatEventRef = React.useRef<(event: OpenClawChatEvent) => void>(() => {});
    const handleToolStreamRef = React.useRef<(event: OpenClawToolStreamEvent) => void>(() => {});

    // Stable callback for onEvent - uses ref to always call latest handler
    const onEventCallback = React.useCallback((event: string, payload: unknown) => {
        if (event === 'chat' && payload) {
            const p = payload as Record<string, unknown>;
            if (p.state && p.sessionKey) {
                handleChatEventRef.current(payload as OpenClawChatEvent);
            }
        } else if (event === 'agent' && payload) {
            const p = payload as Record<string, unknown>;

            if (p.stream === 'assistant' && p.data && p.sessionKey) {
                const data = p.data as { delta?: string; text?: string; thinking?: string };
                const blocks: OpenClawContentBlock[] = [];
                if (data.thinking) {
                    blocks.push({ type: 'thinking', thinking: data.thinking });
                }
                if (data.text) {
                    blocks.push({ type: 'text', text: data.text });
                }
                if (blocks.length > 0) {
                    handleChatEventRef.current({
                        state: 'delta',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        seq: 0,
                        message: { role: 'assistant', content: blocks },
                    });
                }
            } else if (p.stream === 'tool' && p.data && p.sessionKey) {
                const data = p.data as { phase?: string; name?: string; toolCallId?: string; args?: Record<string, unknown>; isError?: boolean };
                if (data.toolCallId && data.phase) {
                    handleToolStreamRef.current({
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        toolCallId: data.toolCallId,
                        phase: data.phase as 'start' | 'update' | 'result',
                        name: data.name,
                        args: data.args,
                        isError: data.isError,
                    });
                }
            } else if (p.stream === 'lifecycle' && p.data) {
                const data = p.data as { state?: string; error?: string };
                if (data.state === 'completed') {
                    handleChatEventRef.current({
                        state: 'final',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        seq: 0,
                    });
                } else if (data.state === 'error') {
                    handleChatEventRef.current({
                        state: 'error',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string ?? '',
                        errorMessage: data.error,
                        seq: 0,
                    });
                } else if (data.state === 'aborted') {
                    handleChatEventRef.current({
                        state: 'aborted',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string ?? '',
                        seq: 0,
                    });
                }
            }
        }
    }, []);

    // Connection hook
    const {
        isConnected,
        isConnecting,
        send,
    } = useOpenClawConnection(machineId ?? '', {
        autoConnect: true,
        onEvent: onEventCallback,
    });

    // Single source of truth: messages list
    // Contains: history messages + pending user message + streaming AI message
    const [messages, setMessages] = React.useState<LocalMessage[]>([]);
    const [inputText, setInputText] = React.useState('');
    // Initial loading state: true until first history fetch completes
    const [isLoading, setIsLoading] = React.useState(true);

    // Track current run for streaming (not used for rendering, only for event filtering)
    const chatRunIdRef = React.useRef<string | null>(null);

    const flatListRef = React.useRef<FlatList<LocalMessage>>(null);
    // Scroll state
    const userNearBottomRef = React.useRef(true);
    const shouldForceScrollRef = React.useRef(false);

    // Extract text from message content
    const extractText = (message: unknown): string | null => {
        if (!message || typeof message !== 'object') return null;
        const msg = message as { content?: unknown };
        if (!msg.content) return null;
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
            const textBlocks = msg.content
                .filter((block: Record<string, unknown>) =>
                    block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
                )
                .map((block: Record<string, unknown>) => block.text as string);
            return textBlocks.length > 0 ? textBlocks.join('\n') : null;
        }
        return null;
    };

    // Fetch chat history and replace messages list
    const fetchHistory = React.useCallback(async () => {
        try {
            const result = await send('chat.history', { sessionKey, limit: 100 });
            if (!result || !result.ok) {
                // Request failed, keep existing messages
                return;
            }
            const history = (result.payload as { messages?: OpenClawChatMessage[] }).messages ?? [];
            // Convert to LocalMessage format - use stable IDs based on index + role + timestamp
            const localMessages: LocalMessage[] = history.map((msg, index) => ({
                ...msg,
                localId: `${msg.role}-${index}-${msg.timestamp ?? index}`,
                status: msg.role === 'user' ? 'sent' : undefined,
            }));
            // Single atomic update - replaces entire list
            setMessages(localMessages);
            // Clear run ID
            chatRunIdRef.current = null;
        } catch (err) {
            console.error('Failed to fetch chat history:', err);
        }
    }, [send, sessionKey]);

    // Handle incoming chat events
    const handleChatEvent = React.useCallback((event: OpenClawChatEvent) => {
        if (event.sessionKey !== sessionKey) return;

        if (event.runId && chatRunIdRef.current && event.runId !== chatRunIdRef.current) {
            if (event.state === 'final') {
                fetchHistory();
            }
            return;
        }

        switch (event.state) {
            case 'delta': {
                const msg = event.message;
                if (!msg) break;
                setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.isStreaming) {
                        // Cumulative guard: only update if new content is at least as large
                        const prevLen = typeof lastMsg.content === 'string' ? lastMsg.content.length : lastMsg.content.length;
                        const nextLen = typeof msg.content === 'string' ? msg.content.length : msg.content.length;
                        if (nextLen < prevLen) return prev;
                        return [
                            ...prev.slice(0, -1),
                            { ...lastMsg, content: msg.content },
                        ];
                    }
                    return [
                        ...prev,
                        {
                            role: 'assistant',
                            content: msg.content,
                            localId: STREAMING_MESSAGE_ID,
                            timestamp: Date.now(),
                            isStreaming: true,
                        },
                    ];
                });
                break;
            }

            case 'final':
                fetchHistory();
                break;

            case 'aborted':
            case 'error':
                setMessages((prev) => prev.filter((m) => !m.isStreaming));
                chatRunIdRef.current = null;
                if (event.errorMessage) {
                    console.error('[OpenClaw Chat] error:', event.errorMessage);
                }
                break;
        }
    }, [sessionKey, fetchHistory]);

    // Keep ref updated with latest handleChatEvent
    handleChatEventRef.current = handleChatEvent;

    const handleToolStream = React.useCallback((event: OpenClawToolStreamEvent) => {
        if (event.sessionKey !== sessionKey) return;

        setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (!lastMsg?.isStreaming) return prev;

            const toolCalls = { ...lastMsg.activeToolCalls };
            if (event.phase === 'start') {
                toolCalls[event.toolCallId] = { name: event.name ?? 'tool', status: 'running' };
            } else if (event.phase === 'result') {
                toolCalls[event.toolCallId] = {
                    name: toolCalls[event.toolCallId]?.name ?? event.name ?? 'tool',
                    status: event.isError ? 'failed' : 'completed',
                };
            }

            return [
                ...prev.slice(0, -1),
                { ...lastMsg, activeToolCalls: toolCalls },
            ];
        });
    }, [sessionKey]);

    handleToolStreamRef.current = handleToolStream;

    // Fetch chat history when connected
    React.useEffect(() => {
        if (isConnected && sessionKey) {
            setIsLoading(true);
            userNearBottomRef.current = true;
            fetchHistory().finally(() => setIsLoading(false));
        }
    }, [isConnected, sessionKey, fetchHistory]);

    // Scroll when messages change (if user is near bottom)
    React.useEffect(() => {
        if (messages.length > 0 && userNearBottomRef.current) {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
    }, [messages]);

    // Check if currently streaming
    const isStreaming = messages.some((msg) => msg.isStreaming);

    // Send a message
    const sendMessage = React.useCallback(async (localId: string, text: string) => {
        const runId = randomUUID();

        // Send to gateway
        const result = await send('chat.send', {
            sessionKey,
            message: text,
            idempotencyKey: runId,
        });

        if (!result || !result.ok) {
            // Mark message as failed
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.localId === localId
                        ? { ...msg, status: 'failed' as MessageStatus, errorMessage: result?.error }
                        : msg
                )
            );
        } else {
            // Mark message as sent, set up for streaming
            chatRunIdRef.current = runId;
            setMessages((prev) => {
                const updated = prev.map((msg) =>
                    msg.localId === localId
                        ? { ...msg, status: 'sent' as MessageStatus }
                        : msg
                );
                // Add streaming placeholder
                return [
                    ...updated,
                    {
                        role: 'assistant' as const,
                        content: '',
                        localId: STREAMING_MESSAGE_ID,
                        timestamp: Date.now(),
                        isStreaming: true,
                    },
                ];
            });
        }
    }, [sessionKey, send]);

    // Handle scroll event - track if user is near bottom
    const handleScroll = React.useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const { contentOffset } = event.nativeEvent;
        // In inverted list, near bottom means near offset 0
        userNearBottomRef.current = contentOffset.y < 200;
    }, []);

    // Handle new message send
    const handleSend = React.useCallback(async () => {
        const text = inputText.trim();
        if (!text || !isConnected || isStreaming) {
            return;
        }

        // Force scroll when sending a message
        shouldForceScrollRef.current = true;

        // Create user message with sending status
        const localId = randomUUID();
        const userMessage: LocalMessage = {
            role: 'user',
            content: text,
            timestamp: Date.now(),
            localId,
            status: 'sending',
        };

        // Add to messages list
        setMessages((prev) => [...prev, userMessage]);
        setInputText('');

        // Scroll to show the new message
        setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }, 50);

        // Send the message
        await sendMessage(localId, text);
    }, [inputText, isConnected, isStreaming, sendMessage]);

    // Handle retry for failed messages
    const handleRetry = React.useCallback((localId: string) => {
        const message = messages.find((msg) => msg.localId === localId);
        if (!message || message.status !== 'failed') return;

        // Update status to sending
        setMessages((prev) =>
            prev.map((msg) =>
                msg.localId === localId
                    ? { ...msg, status: 'sending' as MessageStatus, errorMessage: undefined }
                    : msg
            )
        );

        const text = extractText(message) ?? '';

        sendMessage(localId, text);
    }, [messages, sendMessage]);

    // Handle keyboard shortcuts: Enter to send, Shift+Enter for newline
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        if (Platform.OS === 'web' && event.key === 'Enter' && !event.shiftKey) {
            if (inputText.trim() && isConnected && !isStreaming) {
                handleSend();
                return true;
            }
        }
        return false;
    }, [inputText, isConnected, isStreaming, handleSend]);

    // Session name for header title (decode URL encoding)
    const sessionName = sessionNameParam
        ? decodeURIComponent(sessionNameParam)
        : sessionKey
            ? decodeURIComponent(sessionKey)
            : t('openclaw.sessions');
    // Machine name for header subtitle
    const machineName = machine?.metadata?.name;

    const canSend = inputText.trim().length > 0 && isConnected && !isStreaming;

    // Content: message list (only when we have messages)
    const content = messages.length > 0 ? (
        <FlatList
            ref={flatListRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            data={[...messages].reverse()}
            keyExtractor={(item) => item.localId}
            renderItem={({ item }) => (
                <MessageItem
                    message={item}
                    onRetry={handleRetry}
                />
            )}
            inverted
            onScroll={handleScroll}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
                if (shouldForceScrollRef.current || userNearBottomRef.current) {
                    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
                    shouldForceScrollRef.current = false;
                }
            }}
            maintainVisibleContentPosition={{
                minIndexForVisible: 0,
            }}
        />
    ) : null;

    // Placeholder: loading or empty state
    const placeholder = isLoading ? (
        <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={theme.colors.textSecondary} />
        </View>
    ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyTitle, { marginTop: 16 }]}>
                {t('openclaw.noSessions')}
            </Text>
            <Text style={styles.emptyDescription}>
                {t('openclaw.noSessionsDescription')}
            </Text>
        </View>
    ) : null;

    // Input area
    const input = (
        <View style={[styles.inputContainer, { paddingBottom: safeArea.bottom + 16 }]}>
            <View style={styles.inputInner}>
                <View style={styles.inputPanel}>
                    <View style={styles.inputWrapper}>
                        <MultiTextInput
                            value={inputText}
                            onChangeText={setInputText}
                            placeholder={t('session.inputPlaceholder')}
                            maxHeight={150}
                            lineHeight={24}
                            paddingTop={4}
                            paddingBottom={4}
                            onKeyPress={handleKeyPress}
                        />
                    </View>
                    <Pressable
                        style={({ pressed }) => [
                            styles.sendButton,
                            canSend ? styles.sendButtonActive : styles.sendButtonDisabled,
                            pressed && canSend && { opacity: 0.7 },
                        ]}
                        onPress={handleSend}
                        disabled={!canSend}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons
                            name="arrow-up"
                            size={18}
                            color={canSend ? theme.colors.button.primary.tint : theme.colors.textSecondary}
                        />
                    </Pressable>
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    headerLeft: () => (
                        <Pressable
                            onPress={() => router.back()}
                            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                        >
                            <Ionicons
                                name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                                size={Platform.OS === 'ios' ? 28 : 24}
                                color={theme.colors.header.tint}
                            />
                        </Pressable>
                    ),
                    headerTitle: () => (
                        <View style={{ alignItems: 'center', justifyContent: 'center', maxWidth: headerTitleMaxWidth }}>
                            <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[Typography.default('semiBold'), { fontSize: 17, lineHeight: 24, color: theme.colors.header.tint, flexShrink: 1 }]}
                            >
                                {sessionName}
                            </Text>
                            {machineName && (
                                <Text
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                    style={[Typography.default(), { fontSize: 12, color: theme.colors.header.tint, opacity: 0.7, marginTop: -2 }]}
                                >
                                    {machineName}
                                </Text>
                            )}
                        </View>
                    ),
                    headerRight: () => null,
                }}
            />
            <AgentContentView
                content={content}
                input={input}
                placeholder={placeholder}
            />
        </View>
    );
}
