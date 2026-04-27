/**
 * happy_session_messages — paginated decrypted message log for a session.
 *
 * Pulls from GET /v3/sessions/:id/messages, resolves the session key, decrypts
 * each row. Pagination is seq-based (server's native cursoring).
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { fetchSessionById } from '../sessionFetch';
import { decryptMessage, DecryptedMessage } from '../messageDecrypt';

export const sessionMessagesInputSchema = {
    sessionId: z.string().describe('Target session ID (from happy_session_list).'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Max messages per call. Default: 50.'),
    beforeSeq: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Return messages with seq < this value (paginate backwards). Mutually exclusive with afterSeq.'),
    afterSeq: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Return messages with seq > this value (paginate forwards). Mutually exclusive with beforeSeq.'),
};

interface SessionMessagesInput {
    sessionId: string;
    limit?: number;
    beforeSeq?: number;
    afterSeq?: number;
}

interface SessionMessagesResult {
    sessionId: string;
    messages: Array<Pick<DecryptedMessage,
        'id' | 'seq' | 'role' | 'content' | 'sentBy' | 'sentByName' | 'createdAt' | 'updatedAt'
    >>;
    hasMore: boolean;
    nextBeforeSeq: number | null;
    nextAfterSeq: number | null;
}

export async function runSessionMessages(
    credentials: Credentials,
    input: SessionMessagesInput,
): Promise<SessionMessagesResult> {
    if (input.beforeSeq !== undefined && input.afterSeq !== undefined) {
        throw new Error('Specify only one of beforeSeq / afterSeq, not both.');
    }

    const session = await fetchSessionById(credentials, input.sessionId);
    if (!session) {
        throw new Error(`Session ${input.sessionId} not found or not decryptable.`);
    }

    const params: Record<string, string> = {
        limit: String(input.limit ?? 50),
    };
    if (input.beforeSeq !== undefined) params.before_seq = String(input.beforeSeq);
    if (input.afterSeq !== undefined) params.after_seq = String(input.afterSeq);

    const response = await axios.get<{ messages: any[]; hasMore: boolean }>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(input.sessionId)}/messages`,
        {
            params,
            headers: { Authorization: `Bearer ${credentials.token}` },
            timeout: 10000,
        },
    );

    const decrypted = response.data.messages.map((raw) =>
        decryptMessage(raw, session.encryptionKey, session.encryptionVariant),
    );

    // Server returns asc when after_seq is set, otherwise desc. Surface seq
    // boundaries so callers can keep paging without re-deriving them.
    const seqs = decrypted.map((m) => m.seq);
    const minSeq = seqs.length > 0 ? Math.min(...seqs) : null;
    const maxSeq = seqs.length > 0 ? Math.max(...seqs) : null;

    return {
        sessionId: input.sessionId,
        messages: decrypted.map((m) => ({
            id: m.id,
            seq: m.seq,
            role: m.role,
            content: m.content,
            sentBy: m.sentBy,
            sentByName: m.sentByName,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
        })),
        hasMore: response.data.hasMore,
        nextBeforeSeq: minSeq,
        nextAfterSeq: maxSeq,
    };
}
