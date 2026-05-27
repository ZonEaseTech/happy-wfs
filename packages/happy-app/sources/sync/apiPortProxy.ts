import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export type PortProxyRecord = {
    id: string;
    machineId: string;
    name: string;
    localHost: '127.0.0.1' | 'localhost' | '::1';
    localPort: number;
    protocol: 'http';
    slug: string;
    enabled: boolean;
    accessMode: 'private';
    lastAccessedAt: number | null;
    createdAt: number;
    updatedAt: number;
};

export type CreatePortProxyInput = {
    machineId: string;
    name: string;
    localHost: '127.0.0.1' | 'localhost' | '::1';
    localPort: number;
    protocol: 'http';
    enabled: boolean;
};

export type UpdatePortProxyInput = Partial<Pick<CreatePortProxyInput, 'name' | 'localHost' | 'localPort' | 'enabled'>>;

type PortProxyResponse = {
    proxy: PortProxyRecord;
};

function authHeaders(credentials: AuthCredentials): Record<string, string> {
    return {
        Authorization: `Bearer ${credentials.token}`,
    };
}

function jsonHeaders(credentials: AuthCredentials): Record<string, string> {
    return {
        ...authHeaders(credentials),
        'Content-Type': 'application/json',
    };
}

function portProxyUrl(id?: string): string {
    const base = getServerUrl().replace(/\/+$/, '');
    const path = id ? `/v1/port-proxies/${encodeURIComponent(id)}` : '/v1/port-proxies';
    return `${base}${path}`;
}

function assertOk(response: Response, action: string): void {
    if (!response.ok) {
        throw new Error(`Failed to ${action}: ${response.status}`);
    }
}

export async function listPortProxies(credentials: AuthCredentials): Promise<PortProxyRecord[]> {
    return await backoff(async () => {
        const response = await fetch(portProxyUrl(), {
            method: 'GET',
            headers: authHeaders(credentials),
        });

        assertOk(response, 'list port proxies');

        return await response.json() as PortProxyRecord[];
    });
}

export async function createPortProxy(
    credentials: AuthCredentials,
    input: CreatePortProxyInput,
): Promise<PortProxyRecord> {
    return await backoff(async () => {
        const response = await fetch(portProxyUrl(), {
            method: 'POST',
            headers: jsonHeaders(credentials),
            body: JSON.stringify(input),
        });

        assertOk(response, 'create port proxy');

        const data = await response.json() as PortProxyResponse;
        return data.proxy;
    });
}

export async function updatePortProxy(
    credentials: AuthCredentials,
    id: string,
    input: UpdatePortProxyInput,
): Promise<PortProxyRecord> {
    return await backoff(async () => {
        const response = await fetch(portProxyUrl(id), {
            method: 'PATCH',
            headers: jsonHeaders(credentials),
            body: JSON.stringify(input),
        });

        assertOk(response, 'update port proxy');

        const data = await response.json() as PortProxyResponse;
        return data.proxy;
    });
}

export async function deletePortProxy(credentials: AuthCredentials, id: string): Promise<void> {
    return await backoff(async () => {
        const response = await fetch(portProxyUrl(id), {
            method: 'DELETE',
            headers: authHeaders(credentials),
        });

        assertOk(response, 'delete port proxy');
    });
}

export function buildPortProxyUrl(apiBaseUrl: string, proxy: Pick<PortProxyRecord, 'slug'>): string {
    const base = apiBaseUrl.replace(/\/+$/, '');
    return `${base}/p/${proxy.slug}/`;
}
