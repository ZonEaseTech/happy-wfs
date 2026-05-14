/**
 * happy_session_summary — compact, bounded session reader.
 *
 * This is intentionally not an LLM summary. It is a deterministic extractor that
 * keeps the parts agents usually need (user prompts, assistant text, compact tool
 * names, cursors) and drops high-volume raw thinking/event/tool payloads. Use it
 * before `happy_session_messages` when a session is large.
 */

import axios from 'axios';
import { z } from 'zod';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { fetchSessionById } from '../sessionFetch';
import { decryptMessage, DecryptedMessage } from '../messageDecrypt';

const DEFAULT_LIMIT = 200;
const DEFAULT_TEXT_LIMIT = 800;
const DEFAULT_MAX_TURNS = 80;
const DEFAULT_MAX_TOOLS_PER_TURN = 12;

export const sessionSummaryInputSchema = {
    sessionId: z.string().describe('Target session ID (from happy_session_list).'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe(`Max raw messages to compact in this call. Default: ${DEFAULT_LIMIT}.`),
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
    maxTurns: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe(`Max compact turns to return. Default: ${DEFAULT_MAX_TURNS}.`),
    textLimit: z
        .number()
        .int()
        .min(80)
        .max(4000)
        .optional()
        .describe(`Max chars per user/assistant text block. Default: ${DEFAULT_TEXT_LIMIT}.`),
    includeTools: z
        .boolean()
        .optional()
        .describe('Include compact tool-use names. Default: true.'),
    maxToolsPerTurn: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe(`Max tool names per turn when includeTools=true. Default: ${DEFAULT_MAX_TOOLS_PER_TURN}.`),
};

export interface SessionSummaryInput {
    sessionId: string;
    limit?: number;
    beforeSeq?: number;
    afterSeq?: number;
    maxTurns?: number;
    textLimit?: number;
    includeTools?: boolean;
    maxToolsPerTurn?: number;
}

export interface CompactUserMessage {
    seq: number;
    createdAt: number;
    text: string;
    imageCount: number;
}

export interface CompactAssistantText {
    seq: number;
    createdAt: number;
    text: string;
}

export interface CompactToolUse {
    seq: number;
    createdAt: number;
    name: string;
}

export interface CompactTurn {
    startSeq: number;
    endSeq: number;
    startedAt: number;
    user: CompactUserMessage | null;
    assistantTexts: CompactAssistantText[];
    tools: CompactToolUse[];
    omittedToolCount: number;
}

export interface SessionSummaryResult {
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
    storedSummary: string | null;
    messageWindow: {
        rawCount: number;
        compactedCount: number;
        hasMore: boolean;
        nextBeforeSeq: number | null;
        nextAfterSeq: number | null;
    };
    turns: CompactTurn[];
    summaryText: string;
}

function trimText(text: string, limit: number): string {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, limit)}…`;
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function imageCount(content: any): number {
    return Array.isArray(content?.images) ? content.images.length : 0;
}

function assistantContentItems(messageData: any): any[] {
    if (Array.isArray(messageData?.message?.content)) {
        return messageData.message.content;
    }
    if (Array.isArray(messageData?.content)) {
        return messageData.content;
    }
    return [];
}

function extractAssistantTexts(message: DecryptedMessage, textLimit: number): string[] {
    const content = message.content as any;
    if (content?.type !== 'output') return [];

    const data = content.data;
    if (typeof data === 'string') {
        return [trimText(data, textLimit)].filter(Boolean);
    }
    if (!data || typeof data !== 'object') return [];

    const directMessage = typeof (data as any).message === 'string' ? (data as any).message : null;
    if (directMessage) {
        return [trimText(directMessage, textLimit)].filter(Boolean);
    }

    const directText = typeof (data as any).text === 'string' ? (data as any).text : null;
    if (directText) {
        return [trimText(directText, textLimit)].filter(Boolean);
    }

    return assistantContentItems(data)
        .filter((item) => item?.type === 'text' && typeof item.text === 'string')
        .map((item) => trimText(item.text, textLimit))
        .filter(Boolean);
}

function extractToolNames(message: DecryptedMessage): string[] {
    const content = message.content as any;
    if (content?.type !== 'output') return [];

    const data = content.data;
    if (!data || typeof data !== 'object') return [];

    const names: string[] = [];
    for (const item of assistantContentItems(data)) {
        if (item?.type === 'tool_use' && typeof item.name === 'string') {
            names.push(item.name);
        }
        if (item?.type === 'tool_call' && typeof item.name === 'string') {
            names.push(item.name);
        }
    }

    const directToolName = typeof (data as any).toolName === 'string'
        ? (data as any).toolName
        : typeof (data as any).name === 'string' && ((data as any).type === 'tool_call' || (data as any).type === 'tool_use')
            ? (data as any).name
            : null;
    if (directToolName) {
        names.push(directToolName);
    }

    return names;
}

function pushTurn(turns: CompactTurn[], turn: CompactTurn | null): void {
    if (!turn) return;
    if (!turn.user && turn.assistantTexts.length === 0 && turn.tools.length === 0) return;
    turns.push(turn);
}

export function compactSessionMessages(
    messages: DecryptedMessage[],
    options: {
        textLimit: number;
        maxTurns: number;
        includeTools: boolean;
        maxToolsPerTurn: number;
    },
): { turns: CompactTurn[]; compactedCount: number } {
    const chronological = [...messages].sort((a, b) => a.seq - b.seq);
    const turns: CompactTurn[] = [];
    let current: CompactTurn | null = null;
    let compactedCount = 0;

    for (const message of chronological) {
        if (message.role === 'user') {
            const content = message.content as any;
            const text = typeof content?.text === 'string' ? trimText(content.text, options.textLimit) : '';
            if (!text && imageCount(content) === 0) continue;

            pushTurn(turns, current);
            current = {
                startSeq: message.seq,
                endSeq: message.seq,
                startedAt: message.createdAt,
                user: {
                    seq: message.seq,
                    createdAt: message.createdAt,
                    text,
                    imageCount: imageCount(content),
                },
                assistantTexts: [],
                tools: [],
                omittedToolCount: 0,
            };
            compactedCount += 1;
            continue;
        }

        const texts = extractAssistantTexts(message, options.textLimit);
        const toolNames = options.includeTools ? extractToolNames(message) : [];
        if (texts.length === 0 && toolNames.length === 0) continue;

        if (!current) {
            current = {
                startSeq: message.seq,
                endSeq: message.seq,
                startedAt: message.createdAt,
                user: null,
                assistantTexts: [],
                tools: [],
                omittedToolCount: 0,
            };
        }
        current.endSeq = message.seq;

        for (const text of texts) {
            current.assistantTexts.push({ seq: message.seq, createdAt: message.createdAt, text });
            compactedCount += 1;
        }

        for (const name of toolNames) {
            if (current.tools.length < options.maxToolsPerTurn) {
                current.tools.push({ seq: message.seq, createdAt: message.createdAt, name });
            } else {
                current.omittedToolCount += 1;
            }
            compactedCount += 1;
        }
    }

    pushTurn(turns, current);

    return {
        turns: turns.slice(-options.maxTurns),
        compactedCount,
    };
}

function formatTimestamp(ms: number): string {
    return new Date(ms).toISOString();
}

function buildSummaryText(result: Omit<SessionSummaryResult, 'summaryText'>): string {
    const lines: string[] = [];
    lines.push(`# Happy session ${result.sessionId}`);
    lines.push('');
    lines.push(`- Active: ${result.active ? 'yes' : 'no'}`);
    lines.push(`- Agent: ${[result.agent.name, result.agent.model].filter(Boolean).join(' / ') || 'unknown'}`);
    lines.push(`- Path: ${result.path ?? 'unknown'}`);
    lines.push(`- Updated: ${formatTimestamp(result.updatedAt)}`);
    if (result.storedSummary) {
        lines.push(`- Stored summary: ${oneLine(result.storedSummary)}`);
    }
    lines.push(`- Window: ${result.messageWindow.rawCount} raw messages, ${result.messageWindow.compactedCount} compact items, hasMore=${result.messageWindow.hasMore}`);
    lines.push('');

    if (result.turns.length === 0) {
        lines.push('No user/assistant text found in this window.');
        return lines.join('\n');
    }

    result.turns.forEach((turn, index) => {
        lines.push(`## Turn ${index + 1} (seq ${turn.startSeq}-${turn.endSeq})`);
        if (turn.user) {
            const imageSuffix = turn.user.imageCount > 0 ? ` [${turn.user.imageCount} image${turn.user.imageCount === 1 ? '' : 's'}]` : '';
            lines.push(`User: ${oneLine(turn.user.text) || '(no text)'}${imageSuffix}`);
        } else {
            lines.push('User: (continuation before the first user message in this window)');
        }
        for (const text of turn.assistantTexts) {
            lines.push(`Assistant: ${oneLine(text.text)}`);
        }
        if (turn.tools.length > 0) {
            const omitted = turn.omittedToolCount > 0 ? `, +${turn.omittedToolCount} more` : '';
            lines.push(`Tools: ${turn.tools.map((tool) => tool.name).join(', ')}${omitted}`);
        }
        lines.push('');
    });

    return lines.join('\n').trimEnd();
}

export async function runSessionSummary(
    credentials: Credentials,
    input: SessionSummaryInput,
): Promise<SessionSummaryResult> {
    if (input.beforeSeq !== undefined && input.afterSeq !== undefined) {
        throw new Error('Specify only one of beforeSeq / afterSeq, not both.');
    }

    const session = await fetchSessionById(credentials, input.sessionId);
    if (!session) {
        throw new Error(`Session ${input.sessionId} not found or not decryptable.`);
    }

    const params: Record<string, string> = {
        limit: String(input.limit ?? DEFAULT_LIMIT),
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
    const compacted = compactSessionMessages(decrypted, {
        textLimit: input.textLimit ?? DEFAULT_TEXT_LIMIT,
        maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
        includeTools: input.includeTools ?? true,
        maxToolsPerTurn: input.maxToolsPerTurn ?? DEFAULT_MAX_TOOLS_PER_TURN,
    });

    const seqs = decrypted.map((message) => message.seq);
    const minSeq = seqs.length > 0 ? Math.min(...seqs) : null;
    const maxSeq = seqs.length > 0 ? Math.max(...seqs) : null;
    const meta = session.metadata ?? {};

    const resultWithoutText: Omit<SessionSummaryResult, 'summaryText'> = {
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
        storedSummary: typeof meta.summary?.text === 'string' ? meta.summary.text : null,
        messageWindow: {
            rawCount: decrypted.length,
            compactedCount: compacted.compactedCount,
            hasMore: response.data.hasMore,
            nextBeforeSeq: minSeq,
            nextAfterSeq: maxSeq,
        },
        turns: compacted.turns,
    };

    return {
        ...resultWithoutText,
        summaryText: buildSummaryText(resultWithoutText),
    };
}
