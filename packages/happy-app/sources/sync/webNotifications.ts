import { Platform } from 'react-native';

/**
 * Browser Notification API helpers (web only). Native platforms use Expo
 * push notifications instead. Mention notifications fire only when the tab
 * is not focused — a focused user already sees the inbox dot.
 */

function webNotificationApi(): typeof Notification | null {
    if (Platform.OS !== 'web') return null;
    if (typeof Notification === 'undefined') return null;
    return Notification;
}

export function requestWebNotificationPermission() {
    const api = webNotificationApi();
    if (!api || api.permission !== 'default') return;
    api.requestPermission().catch(() => { });
}

export function showWebMentionNotification(params: {
    title: string;
    body?: string;
    sessionId: string;
    tag: string;
}) {
    const api = webNotificationApi();
    if (!api || api.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.hasFocus()) return;
    try {
        const notification = new api(params.title, {
            body: params.body,
            tag: params.tag,
        });
        notification.onclick = () => {
            window.focus();
            window.location.href = `/session/${params.sessionId}`;
            notification.close();
        };
    } catch {
        // Some browsers (mobile Safari) throw on direct construction; ignore.
    }
}
