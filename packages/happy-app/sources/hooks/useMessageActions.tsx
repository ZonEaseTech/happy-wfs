import * as React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast, showToast } from '@/components/Toast';
import { getCurrentAuth } from '@/auth/AuthContext';
import { createMemory } from '@/sync/apiMemory';
import { t } from '@/text';

interface UseMessageActionsResult {
    /** Trigger the action sheet. Bind to onLongPress / a "..." button etc. */
    showActions: () => void;
    /** Must be rendered in the consumer's tree so the bottom-sheet menu can appear. */
    actionsOverlay: React.ReactNode;
}

/**
 * Long-press / "more" action sheet for a chat message.
 *
 * Replaces the previous single-action `pinMessageToMemory` confirm dialog —
 * which hijacked iOS native text selection and offered no copy path. Now
 * surfaces both [Copy / Save to memory] in an iOS-style bottom sheet.
 *
 * Reads auth lazily via getCurrentAuth() so MessageView doesn't subscribe to
 * the auth context.
 */
export function useMessageActions(rawText: string, sessionId: string, messageId: string): UseMessageActionsResult {
    const [visible, setVisible] = React.useState(false);

    const showActions = React.useCallback(() => {
        if (!rawText.trim()) return;
        hapticsLight();
        setVisible(true);
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

    const items = React.useMemo<ActionMenuItem[]>(() => [
        { label: t('common.copy'), onPress: () => { void handleCopy(); } },
        { label: t('memory.pinAction'), onPress: () => { void handleSaveToMemory(); } },
    ], [handleCopy, handleSaveToMemory]);

    const actionsOverlay = (
        <ActionMenuModal
            visible={visible}
            items={items}
            onClose={() => setVisible(false)}
        />
    );

    return { showActions, actionsOverlay };
}
