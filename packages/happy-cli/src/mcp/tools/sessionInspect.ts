/**
 * happy_session_inspect — at-a-glance status for a single session.
 *
 * One-call answer to "what is session X doing right now?":
 *   - status (active/idle), agent name/model/mode, machine, last-active timestamp
 *   - last few decrypted messages summarised as previews (200 chars each)
 *   - current pending tool call hint (best-effort from agentState)
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { fetchSessionById } from '../sessionFetch';
import { decryptMessage } from '../messageDecrypt';

const PREVIEW_LIMIT = 200;
const TAIL_MESSAGES = 5;

export const sessionInspectInputSchema = {
    sessionId: z.string().describe('Target session ID (from happy_session_list).'),
    tail: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe(`How many trailing messages to include. Default: ${TAIL_MESSAGES}.`),
};

interface SessionInspectInput {
    sessionId: string;
    tail?: number;
}

interface MessagePreview {
    seq: number;
    role: 'user' | 'agent' | 'unknown';
    sentByName: string | null;
    preview: string;
    createdAt: number;
}

interface SessionInspectResult {
    sessionId: string;
    active: boolean;
    activeAt: number;
    createdAt: number;
    updatedAt: number;
    agent: {
        name: string | null;
        model: string | null;
        mode: string | null;
        flavor: string | null;
    };
    machine: {
        id: string | null;
        name: string | null;
    };
    path: string | null;
    summary: string | null;
    /** Best-effort from session.agentState. Useful for "is Claude waiting?" */
    agentState: Record<string, any> | null;
    lastUserMessage: MessagePreview | null;
    lastAssistantMessage: MessagePreview | null;
    /** Last N messages (oldest first within the tail). */
    recentMessages: MessagePreview[];
}

function trim(text: string): string {
    if (text.length <= PREVIEW_LIMIT) return text;
    return text.slice(0, PREVIEW_LIMIT) + '…';
}

export async function runSessionInspect(
    credentials: Credentials,
    input: SessionInspectInput,
): Promise<SessionInspectResult> {
    const tail = input.tail ?? TAIL_MESSAGES;

    const session = await fetchSessionById(credentials, input.sessionId);
    if (!session) {
        throw new Error(`Session ${input.sessionId} not found or not decryptable.`);
    }

    // GET /v3/.../messages without after_seq returns desc order (newest first).
    // Take `tail` rows then reverse for chronological output.
    const response = await axios.get<{ messages: any[] }>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(input.sessionId)}/messages`,
        {
            params: { limit: String(tail) },
            headers: { Authorization: `Bearer ${credentials.token}` },
            timeout: 10000,
        },
    );

    const recent = response.data.messages
        .map((raw) => decryptMessage(raw, session.encryptionKey, session.encryptionVariant))
        .reverse();

    const previews: MessagePreview[] = recent.map((m) => ({
        seq: m.seq,
        role: m.role,
        sentByName: m.sentByName,
        preview: trim(m.textPreview),
        createdAt: m.createdAt,
    }));

    const lastUser = [...previews].reverse().find((m) => m.role === 'user') ?? null;
    const lastAssistant = [...previews].reverse().find((m) => m.role === 'agent') ?? null;

    const meta = session.metadata ?? {};
    const agentState = session.agentState ?? null;

    return {
        sessionId: session.id,
        active: session.active,
        activeAt: session.activeAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        agent: {
            name: typeof meta.agentName === 'string' ? meta.agentName : null,
            model: typeof meta.model === 'string' ? meta.model : null,
            mode: typeof meta.permissionMode === 'string' ? meta.permissionMode : null,
            flavor: typeof meta.flavor === 'string' ? meta.flavor : null,
        },
        machine: {
            id: typeof meta.machineId === 'string' ? meta.machineId : null,
            name: typeof meta.machineName === 'string' ? meta.machineName : null,
        },
        path: typeof meta.path === 'string' ? meta.path : null,
        summary: typeof meta.summary?.text === 'string' ? meta.summary.text : null,
        agentState,
        lastUserMessage: lastUser,
        lastAssistantMessage: lastAssistant,
        recentMessages: previews,
    };
}
