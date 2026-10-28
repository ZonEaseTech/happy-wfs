import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) { return store.get(key); }
        set(key: string, value: string) { store.set(key, value); }
        delete(key: string) { store.delete(key); }
    },
}));

import { getServerUrl, isUsingCustomServer, setServerUrl } from './serverConfig';

function openedAt(hostname: string | undefined) {
    vi.stubGlobal('window', hostname ? { location: { hostname } } : {});
}

describe('serverConfig', () => {
    beforeEach(() => {
        store.clear();
        vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_URL', 'https://api-happy.zonease.org');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('talks to the API through the relay when the web app is opened at the relay', () => {
        openedAt('cn-happy.weifashi.cn');
        expect(getServerUrl()).toBe('https://cn-api-happy.weifashi.cn');
        expect(isUsingCustomServer()).toBe(false);
    });

    it('keeps the configured server everywhere else', () => {
        openedAt('happy.zonease.org');
        expect(getServerUrl()).toBe('https://api-happy.zonease.org');
        expect(isUsingCustomServer()).toBe(false);
    });

    it('keeps the configured server where there is no page location, as in the native apps', () => {
        openedAt(undefined);
        expect(getServerUrl()).toBe('https://api-happy.zonease.org');
    });

    it('lets a server chosen in settings win over the relay', () => {
        openedAt('cn-happy.weifashi.cn');
        setServerUrl('https://my-happy.example.com');
        expect(getServerUrl()).toBe('https://my-happy.example.com');
        expect(isUsingCustomServer()).toBe(true);
    });
});
