/**
 * happy_session_cancel — abort the currently-running agent turn on a session.
 *
 * Posts to the new HTTP wrapper `POST /v1/sessions/:id/abort`, which proxies
 * to the socket-side RPC `${sessionId}:abort`. RPC params are an empty object
 * encrypted with the session key — the agent process is the only consumer.
 *
 * Returns when the RPC ack lands or 504 timeout. If the session has no active
 * agent (e.g. archived), the server returns an error.
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { encrypt, encodeBase64 } from '@/api/encryption';
import { fetchSessionById } from '../sessionFetch';

export const sessionCancelInputSchema = {
    sessionId: z.string().describe('Target session ID (from happy_session_list).'),
};

interface SessionCancelInput {
    sessionId: string;
}

interface SessionCancelResult {
    sessionId: string;
    /** True if the abort RPC reached an active agent and acknowledged. */
    acknowledged: boolean;
}

export async function runSessionCancel(
    credentials: Credentials,
    input: SessionCancelInput,
): Promise<SessionCancelResult> {
    const session = await fetchSessionById(credentials, input.sessionId);
    if (!session) {
        throw new Error(`Session ${input.sessionId} not found or not decryptable.`);
    }

    // Empty-payload RPC — the agent's `abort` handler ignores params, but the
    // server still requires them encrypted because session RPC always wraps.
    const encryptedParams = encodeBase64(
        encrypt(session.encryptionKey, session.encryptionVariant, {}),
    );

    try {
        const response = await axios.post<{ ok: boolean; error?: string }>(
            `${configuration.serverUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/abort`,
            { params: encryptedParams },
            {
                headers: { Authorization: `Bearer ${credentials.token}` },
                timeout: 12000,
            },
        );
        return {
            sessionId: input.sessionId,
            acknowledged: response.data.ok === true,
        };
    } catch (err: any) {
        // Surface server-mapped errors (502 RPC failure, 504 timeout) verbatim.
        const status = err?.response?.status;
        const message = err?.response?.data?.error || err?.message || 'abort failed';
        if (status === 504) {
            throw new Error(`Abort RPC timed out (the agent may be unresponsive): ${message}`);
        }
        throw new Error(`Abort failed: ${message}`);
    }
}
