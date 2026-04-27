/**
 * happy_session_list — read-only metadata listing.
 *
 * Returns up to N sessions ordered most-recent-first, with status, agent name,
 * machine, last-active timestamp, and message count. Does NOT decrypt message
 * bodies (separate tool: happy_session_messages).
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decryptSessionRow } from '../sessionDecrypt';

export const sessionListInputSchema = {
    status: z
        .enum(['active', 'archived', 'all'])
        .optional()
        .describe('Filter by session state. Default: all.'),
    since: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Only return sessions updated after this epoch-millis timestamp.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(150)
        .optional()
        .describe('Max sessions to return. Default: 50.'),
};

interface SessionListInput {
    status?: 'active' | 'archived' | 'all';
    since?: number;
    limit?: number;
}

interface SessionSummary {
    sessionId: string;
    active: boolean;
    activeAt: number;
    createdAt: number;
    updatedAt: number;
    tag: string | null;
    summary: string | null;
    agentName: string | null;
    machineId: string | null;
    machineName: string | null;
    path: string | null;
    flavor: string | null;
}

export async function runSessionList(
    credentials: Credentials,
    input: SessionListInput,
): Promise<{ sessions: SessionSummary[]; truncated: boolean }> {
    const limit = input.limit ?? 50;

    const params: Record<string, string> = {};
    if (input.since) params.since = String(input.since);

    const response = await axios.get<{ sessions: any[] }>(
        `${configuration.serverUrl}/v1/sessions`,
        {
            params,
            headers: { Authorization: `Bearer ${credentials.token}` },
            timeout: 10000,
        },
    );

    const filtered = response.data.sessions
        .map((row) => decryptSessionRow(credentials, row))
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .filter((row) => {
            if (input.status === 'active') return row.active;
            if (input.status === 'archived') return !row.active;
            return true;
        })
        .slice(0, limit)
        .map<SessionSummary>((row) => {
            const meta = row.metadata ?? {};
            const summary = typeof meta.summary?.text === 'string' ? meta.summary.text : null;
            return {
                sessionId: row.id,
                active: row.active,
                activeAt: row.activeAt,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                tag: typeof (meta as any).tag === 'string' ? (meta as any).tag : null,
                summary,
                agentName: typeof meta.agentName === 'string' ? meta.agentName : null,
                machineId: typeof meta.machineId === 'string' ? meta.machineId : null,
                machineName: typeof meta.machineName === 'string' ? meta.machineName : null,
                path: typeof meta.path === 'string' ? meta.path : null,
                flavor: typeof meta.flavor === 'string' ? meta.flavor : null,
            };
        });

    return {
        sessions: filtered,
        truncated: response.data.sessions.length >= 150,
    };
}
