import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    buildPortProxyUrl,
    createPortProxy,
    deletePortProxy,
    listPortProxies,
    updatePortProxy,
    type CreatePortProxyInput,
} from './apiPortProxy';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://happy.example/api/',
}));

const backoffMock = vi.fn(async <T>(callback: () => Promise<T>) => callback());

vi.mock('@/utils/time', () => ({
    backoff: <T>(callback: () => Promise<T>) => backoffMock(callback),
}));

const credentials: AuthCredentials = {
    token: 'token-1',
    secret: 'secret-1',
};

const proxyRecord = {
    id: 'proxy-1',
    machineId: 'machine-1',
    name: 'Dev server',
    localHost: '127.0.0.1' as const,
    localPort: 3000,
    protocol: 'http' as const,
    slug: 'pp_abc123',
    enabled: true,
    accessMode: 'private' as const,
    lastAccessedAt: null,
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('buildPortProxyUrl', () => {
    it('removes trailing API base slashes before appending the proxy path', () => {
        expect(buildPortProxyUrl('https://happy.example/api/', { slug: 'pp_abc123' }))
            .toBe('https://happy.example/api/p/pp_abc123/');
        expect(buildPortProxyUrl('https://happy.example/api///', { slug: 'pp_abc123' }))
            .toBe('https://happy.example/api/p/pp_abc123/');
    });
});

describe('listPortProxies', () => {
    it('sends an authenticated GET request and returns the proxy list', async () => {
        const fetchMock = vi.fn(async () => jsonResponse([proxyRecord]));
        vi.stubGlobal('fetch', fetchMock);

        await expect(listPortProxies(credentials)).resolves.toEqual([proxyRecord]);

        expect(backoffMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/port-proxies', {
            method: 'GET',
            headers: {
                Authorization: 'Bearer token-1',
            },
        });
    });

    it('throws an error containing the status when the request fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, { ok: false, status: 500 })));

        await expect(listPortProxies(credentials)).rejects.toThrow('500');
    });
});

describe('createPortProxy', () => {
    it('sends an authenticated JSON POST request and returns the created proxy', async () => {
        const input: CreatePortProxyInput = {
            machineId: 'machine-1',
            name: 'Dev server',
            localHost: '127.0.0.1',
            localPort: 3000,
            protocol: 'http',
            enabled: true,
        };
        const fetchMock = vi.fn(async () => jsonResponse({ proxy: proxyRecord }, { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(createPortProxy(credentials, input)).resolves.toEqual(proxyRecord);

        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/port-proxies', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer token-1',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
        });
    });
});

describe('updatePortProxy', () => {
    it('sends an authenticated JSON PATCH request and returns the updated proxy', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ proxy: { ...proxyRecord, enabled: false } }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(updatePortProxy(credentials, 'proxy-1', { enabled: false })).resolves.toEqual({
            ...proxyRecord,
            enabled: false,
        });

        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/port-proxies/proxy-1', {
            method: 'PATCH',
            headers: {
                Authorization: 'Bearer token-1',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ enabled: false }),
        });
    });
});

describe('deletePortProxy', () => {
    it('sends an authenticated DELETE request and resolves without a body', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(deletePortProxy(credentials, 'proxy-1')).resolves.toBeUndefined();

        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/port-proxies/proxy-1', {
            method: 'DELETE',
            headers: {
                Authorization: 'Bearer token-1',
            },
        });
    });
});
