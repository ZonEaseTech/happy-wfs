import * as React from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { listDeviceKeyRequests } from '@/sync/apiDevices';

const POLL_INTERVAL_MS = 30_000;

/**
 * Count of device key requests still waiting for approval. Polled (there is no
 * push channel for these yet) so the sidebar can show a dot without the user
 * opening the devices screen. Paused while a web tab is hidden.
 */
export function usePendingDeviceKeyRequests(): number {
    const auth = useAuth();
    const [count, setCount] = React.useState(0);

    React.useEffect(() => {
        if (!auth.credentials) {
            setCount(0);
            return;
        }
        const credentials = auth.credentials;
        let cancelled = false;
        const load = () => {
            if (Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            listDeviceKeyRequests(credentials)
                .then((requests) => {
                    if (!cancelled) setCount(requests.filter((request) => !request.approved).length);
                })
                .catch(() => { });
        };
        load();
        const interval = setInterval(load, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(interval); };
    }, [auth.credentials]);

    return count;
}
