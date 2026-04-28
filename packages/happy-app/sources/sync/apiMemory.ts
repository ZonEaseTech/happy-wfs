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
    archivedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export type MemoryArchiveFilter = 'active' | 'archived' | 'all';

const json = { 'Content-Type': 'application/json' };

export async function listMemories(
    credentials: AuthCredentials,
    options?: { archived?: MemoryArchiveFilter },
): Promise<MemoryRow[]> {
    const API = getServerUrl();
    const archived = options?.archived ?? 'active';
    return await backoff(async () => {
        const url = new URL(`${API}/v1/memory`);
        url.searchParams.set('archived', archived);
        const res = await fetch(url.toString(), {
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

export async function archiveMemory(credentials: AuthCredentials, id: string): Promise<MemoryRow> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/memory/${id}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        throw new HappyError(`archiveMemory: ${res.status}`, false);
    }
    const data = (await res.json()) as { memory: MemoryRow };
    return data.memory;
}

export async function unarchiveMemory(credentials: AuthCredentials, id: string): Promise<MemoryRow> {
    const API = getServerUrl();
    const res = await fetch(`${API}/v1/memory/${id}/unarchive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.token}` },
    });
    if (!res.ok) {
        throw new HappyError(`unarchiveMemory: ${res.status}`, false);
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
