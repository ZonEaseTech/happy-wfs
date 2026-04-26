import { AuthCredentials } from '@/auth/tokenStorage';
import { HappyError } from '@/utils/errors';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export interface MemoryRow {
    id: string;
    content: string;
    source: 'manual' | 'message-pin';
    sourceSessionId: string | null;
    sourceMessageId: string | null;
    createdAt: number;
    updatedAt: number;
}

const json = { 'Content-Type': 'application/json' };

export async function listMemories(credentials: AuthCredentials): Promise<MemoryRow[]> {
    const API = getServerUrl();
    return await backoff(async () => {
        const res = await fetch(`${API}/v1/memory`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!res.ok) throw new Error(`listMemories: ${res.status}`);
        const data = (await res.json()) as { memories: MemoryRow[] };
        return data.memories;
    });
}

export async function createMemory(
    credentials: AuthCredentials,
    input: {
        content: string;
        source?: 'manual' | 'message-pin';
        sourceSessionId?: string;
        sourceMessageId?: string;
    },
): Promise<MemoryRow> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/memory`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new HappyError(`createMemory: ${res.status} ${errText}`, false);
    }
    const data = (await res.json()) as { memory: MemoryRow };
    return data.memory;
}

export async function updateMemory(
    credentials: AuthCredentials,
    id: string,
    content: string,
): Promise<MemoryRow> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/memory/${id}`, {
        method: 'PATCH',
        headers: { ...json, Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) {
        throw new HappyError(`updateMemory: ${res.status}`, false);
    }
    const data = (await res.json()) as { memory: MemoryRow };
    return data.memory;
}

export async function deleteMemory(credentials: AuthCredentials, id: string): Promise<void> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/memory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        throw new HappyError(`deleteMemory: ${res.status}`, false);
    }
}
