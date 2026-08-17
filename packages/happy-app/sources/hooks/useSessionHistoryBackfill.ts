import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { sync } from '@/sync/sync';

/**
 * Keeps pulling a session's older history in the background while its screen
 * is open, so the chat and the message rail end up holding the whole
 * conversation instead of just the newest page. Only starts once the first
 * page has landed (`isLoaded`), and stops as soon as the screen loses focus so
 * a backgrounded session never keeps fetching.
 */
export function useSessionHistoryBackfill(sessionId: string, isLoaded: boolean) {
    useFocusEffect(
        React.useCallback(() => {
            if (!isLoaded) return;
            sync.startHistoryBackfill(sessionId);
            return () => {
                sync.stopHistoryBackfill(sessionId);
            };
        }, [sessionId, isLoaded])
    );
}
