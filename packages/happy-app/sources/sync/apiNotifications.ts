import { AuthCredentials } from '@/auth/tokenStorage';
import { HappyError } from '@/utils/errors';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export interface FeishuConfigPublic {
    url: string | null;
    secret_set: boolean;
    enabled: boolean;
    lastTestedAt: number | null;
}

export interface FeishuConfigInput {
    url: string | null;
    secret?: string | null;   // null clears, undefined keeps existing
    enabled: boolean;
}

const json = { 'Content-Type': 'application/json' };

export async function getFeishuConfig(credentials: AuthCredentials): Promise<FeishuConfigPublic> {
    const API = getServerUrl();
    return await backoff(async () => {
        const res = await fetch(`${API}/v1/notifications/feishu`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) throw new Error(`getFeishuConfig: ${res.status}`);
        return (await res.json()) as FeishuConfigPublic;
    });
}

export async function getFeishuMentionConfig(credentials: AuthCredentials): Promise<FeishuConfigPublic> {
    const API = getServerUrl();
    return await backoff(async () => {
        const res = await fetch(`${API}/v1/notifications/feishu/mention`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) throw new Error(`getFeishuMentionConfig: ${res.status}`);
        return (await res.json()) as FeishuConfigPublic;
    });
}

export async function putFeishuConfig(
    credentials: AuthCredentials,
    body: FeishuConfigInput,
): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu`, {
        method: 'PUT',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new HappyError(`putFeishuConfig failed: ${res.status} ${err}`, false);
    }
}

export async function putFeishuMentionConfig(
    credentials: AuthCredentials,
    body: FeishuConfigInput,
): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu/mention`, {
        method: 'PUT',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new HappyError(`putFeishuMentionConfig failed: ${res.status} ${err}`, false);
    }
}

export async function getFeishuUserId(credentials: AuthCredentials): Promise<string | null> {
    const API = getServerUrl();
    return await backoff(async () => {
        const res = await fetch(`${API}/v1/notifications/feishu/user-id`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) throw new Error(`getFeishuUserId: ${res.status}`);
        const data = (await res.json()) as { feishuUserId: string | null };
        return data.feishuUserId;
    });
}

export async function putFeishuUserId(
    credentials: AuthCredentials,
    feishuUserId: string | null,
): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu/user-id`, {
        method: 'PUT',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify({ feishuUserId }),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new HappyError(`putFeishuUserId failed: ${res.status} ${err}`, false);
    }
}

export async function testFeishu(credentials: AuthCredentials): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new HappyError(data.error ?? `testFeishu failed: ${res.status}`, false);
    }
}

export async function testFeishuMention(credentials: AuthCredentials): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/notifications/feishu/mention/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new HappyError(data.error ?? `testFeishuMention failed: ${res.status}`, false);
    }
}
