/**
 * Fetch a single session by id, decrypted. Implemented on top of GET /v1/sessions
 * (no dedicated single-session endpoint exists). Returns null if not found or
 * decryption fails.
 *
 * Used by tools that need the per-session encryption key resolved AND the
 * metadata visible (inspect, messages preview).
 */

import axios from 'axios';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decryptSessionRow } from './sessionDecrypt';

export async function fetchSessionById(
    credentials: Credentials,
    sessionId: string,
): Promise<ReturnType<typeof decryptSessionRow> | null> {
    const response = await axios.get<{ sessions: any[] }>(
        `${configuration.serverUrl}/v1/sessions`,
        {
            headers: { Authorization: `Bearer ${credentials.token}` },
            timeout: 10000,
        },
    );

    const row = response.data.sessions.find((s) => s.id === sessionId);
    if (!row) return null;
    return decryptSessionRow(credentials, row);
}
