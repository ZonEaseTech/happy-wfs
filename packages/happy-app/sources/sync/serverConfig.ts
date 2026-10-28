import { MMKV } from 'react-native-mmkv';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = new MMKV({ id: 'server-config' });

const SERVER_KEY = 'custom-server-url';
const DEFAULT_SERVER_URL = 'https://api-happy.zonease.org';

// The same server through a relay in Hong Kong on a mainland-friendly line;
// from mainland China Cloudflare routes via Amsterdam. The web app opened at
// the relay's web host talks to the API through the relay too.
const RELAY_WEB_HOST = 'cn-happy.weifashi.cn';
const RELAY_SERVER_URL = 'https://cn-api-happy.weifashi.cn';

function relayServerUrl(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    return window.location?.hostname === RELAY_WEB_HOST ? RELAY_SERVER_URL : undefined;
}

export function getServerUrl(): string {
    const configured =
        serverConfigStorage.getString(SERVER_KEY) ||
        relayServerUrl() ||
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL ||
        DEFAULT_SERVER_URL;
    return configured;
}

export function setServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.delete(SERVER_KEY);
    }
}

export function isUsingCustomServer(): boolean {
    const url = getServerUrl();
    return url !== DEFAULT_SERVER_URL && url !== RELAY_SERVER_URL;
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean } {
    const url = getServerUrl();
    const isCustom = isUsingCustomServer();
    
    try {
        const parsed = new URL(url);
        const port = parsed.port ? parseInt(parsed.port) : undefined;
        return {
            hostname: parsed.hostname,
            port,
            isCustom
        };
    } catch {
        // Fallback if URL parsing fails
        return {
            hostname: url,
            port: undefined,
            isCustom
        };
    }
}

export function validateServerUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
        return { valid: false, error: 'Server URL cannot be empty' };
    }
    
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'Server URL must use HTTP or HTTPS protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}
