import * as React from 'react';
import { Modal as RNModal, Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast, showToast } from '@/components/Toast';
import { getCurrentAuth } from '@/auth/AuthContext';
import { createMemory } from '@/sync/apiMemory';
import { t } from '@/text';

interface UseMessageActionsResult {
    /** Trigger the menu. Optional (x, y) — if provided AND on web, the menu
     *  renders as a small popover anchored at that mouse position; otherwise
     *  it falls back to the iOS-style bottom-sheet ActionMenuModal. */
    showActions: (x?: number, y?: number) => void;
    /** Bind directly to a Pressable's onContextMenu so right-click on web
     *  opens the popover at the cursor (and also prevents the browser's
     *  native context menu). No-op on native. */
    onContextMenu: (e: any) => void;
    /** Must be rendered in the consumer's tree so the menu can appear. */
    actionsOverlay: React.ReactNode;
}

/**
 * Long-press / right-click action menu for a chat message.
 *
 * - Mobile (iOS / Android): long-press → bottom-sheet ActionMenuModal,
 *   matching iOS HIG.
 * - Web (desktop OR mobile-web): long-press / right-click → small popover
 *   anchored at the mouse position, matching the sidebar row's right-click
 *   menu. Bottom sheets feel out of place on PC and steal half the screen.
 *
 * Reads auth lazily via getCurrentAuth() so MessageView doesn't subscribe to
 * the auth context.
 */
export function useMessageActions(rawText: string, sessionId: string, messageId: string): UseMessageActionsResult {
    const { theme } = useUnistyles();
    const [visible, setVisible] = React.useState(false);
    const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

    const showActions = React.useCallback((x?: number, y?: number) => {
        if (!rawText.trim()) return;
        hapticsLight();
        if (Platform.OS === 'web' && typeof x === 'number' && typeof y === 'number') {
            setPos({ x, y });
        } else {
            setVisible(true);
        }
    }, [rawText]);

    const onContextMenu = React.useCallback((e: any) => {
        if (Platform.OS !== 'web') return;
        if (!rawText.trim()) return;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const x = typeof e?.clientX === 'number' ? e.clientX : 0;
        const y = typeof e?.clientY === 'number' ? e.clientY : 0;
        setPos({ x, y });
    }, [rawText]);

    const handleCopy = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(rawText.trim());
            hapticsLight();
            showCopiedToast();
        } catch {
            Modal.alert(t('common.error'), t('textSelection.failedToCopy'));
        }
    }, [rawText]);

    const handleSaveToMemory = React.useCallback(async () => {
        const trimmed = rawText.trim();
        const auth = getCurrentAuth();
        if (!auth?.credentials) {
            Modal.alert(t('common.error'), t('memory.saveFailed'));
            return;
        }
        try {
            await createMemory(auth.credentials, {
                content: trimmed,
                source: 'message-pin',
                sourceSessionId: sessionId,
                sourceMessageId: messageId,
            });
            hapticsLight();
            showToast(t('memory.saved'));
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : t('memory.saveFailed'));
        }
    }, [rawText, sessionId, messageId]);

    // Items used by both popover and bottom sheet — wrap each onPress so it
    // also tears down whichever overlay is open.
    const closeBoth = React.useCallback(() => {
        setVisible(false);
        setPos(null);
    }, []);
    const items = React.useMemo<ActionMenuItem[]>(() => [
        { label: t('common.copy'), onPress: () => { closeBoth(); void handleCopy(); } },
        { label: t('memory.pinAction'), onPress: () => { closeBoth(); void handleSaveToMemory(); } },
    ], [closeBoth, handleCopy, handleSaveToMemory]);

    const popover = pos && Platform.OS === 'web' ? (
        <RNModal transparent visible animationType="none" onRequestClose={closeBoth}>
            <Pressable
                onPress={closeBoth}
                // @ts-ignore — RN-Web supports onContextMenu via host div forwarding.
                onContextMenu={(e: any) => { e?.preventDefault?.(); closeBoth(); }}
                style={{ flex: 1 }}
            >
                <View
                    onStartShouldSetResponder={() => true}
                    style={{
                        position: 'absolute',
                        left: Math.min(pos.x + 2, (typeof window !== 'undefined' ? window.innerWidth : 0) - 220),
                        top: Math.min(pos.y + 2, (typeof window !== 'undefined' ? window.innerHeight : 0) - 160),
                        minWidth: 200,
                        backgroundColor: theme.colors.surface,
                        borderRadius: 8,
                        paddingVertical: 4,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.18,
                        shadowRadius: 12,
                        elevation: 12,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.divider,
                    }}
                >
                    {items.map((item, idx) => (
                        <Pressable
                            key={idx}
                            onPress={() => { item.onPress?.(); }}
                            style={({ pressed, hovered }: any) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 9,
                                backgroundColor: hovered || pressed ? theme.colors.surfacePressed : 'transparent',
                            })}
                        >
                            <Text style={{
                                fontSize: 13,
                                color: item.destructive ? theme.colors.textDestructive : theme.colors.text,
                                ...Typography.default(),
                            }}>
                                {item.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </Pressable>
        </RNModal>
    ) : null;

    const actionsOverlay = (
        <>
            <ActionMenuModal
                visible={visible}
                items={items}
                onClose={() => setVisible(false)}
            />
            {popover}
        </>
    );

    return { showActions, onContextMenu, actionsOverlay };
}
