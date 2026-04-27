/**
 * happy_session_send — post a user-text message to a session.
 *
 * Builds a `{ role: 'user', content: { type: 'text', text } }` envelope, AES-encrypts
 * with the session's data key, base64-encodes, and POSTs to v3 messages.
 * The agent picks it up via its socket session and responds normally.
 *
 * Doesn't wait for the assistant reply — call happy_session_messages with
 * `afterSeq=<returned firstSeq>` to poll for the response.
 */

import axios from 'axios';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { encrypt, encodeBase64 } from '@/api/encryption';
import { fetchSessionById } from '../sessionFetch';

export const sessionSendInputSchema = {
    sessionId: z.string().describe('Target session ID (from happy_session_list).'),
    text: z.string().min(1).describe('Plain text message body. Trimmed to non-empty.'),
};

interface SessionSendInput {
    sessionId: string;
    text: string;
}

interface SessionSendResult {
    sessionId: string;
    localId: string;
    sentSeq: number | null;
    sentMessageId: string | null;
    /** True when server accepted; false on dedupe-only response (server already had this localId). */
    delivered: boolean;
}

export async function runSessionSend(
    credentials: Credentials,
    input: SessionSendInput,
): Promise<SessionSendResult> {
    const trimmed = input.text.trim();
    if (!trimmed) {
        throw new Error('text must be non-empty after trim.');
    }

    const session = await fetchSessionById(credentials, input.sessionId);
    if (!session) {
        throw new Error(`Session ${input.sessionId} not found or not decryptable.`);
    }

    const userMessage = {
        role: 'user' as const,
        content: { type: 'text' as const, text: trimmed },
    };

    const encryptedContent = encodeBase64(
        encrypt(session.encryptionKey, session.encryptionVariant, userMessage),
    );
    const localId = randomUUID();

    const response = await axios.post<{ messages: Array<{ id: string; seq: number; localId: string | null }> }>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(input.sessionId)}/messages`,
        {
            messages: [{
                content: encryptedContent,
                localId,
                trackCliDelivery: false,
            }],
        },
        {
            headers: { Authorization: `Bearer ${credentials.token}` },
            timeout: 15000,
        },
    );

    const accepted = response.data.messages[0] ?? null;

    return {
        sessionId: input.sessionId,
        localId,
        sentSeq: accepted?.seq ?? null,
        sentMessageId: accepted?.id ?? null,
        delivered: accepted !== null,
    };
}
