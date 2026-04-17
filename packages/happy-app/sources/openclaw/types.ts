/**
 * OpenClaw Types
 *
 * Types for OpenClaw machine management and protocol communication.
 */

import { z } from 'zod';

// === Storage Types ===

/**
 * OpenClaw machine metadata (encrypted)
 */
export const OpenClawMetadataSchema = z.object({
    name: z.string(),
    // Gateway auth token for type='happy' machines (stored encrypted in metadata)
    gatewayToken: z.string().optional(),
});

export type OpenClawMetadata = z.infer<typeof OpenClawMetadataSchema>;

/**
 * OpenClaw pairing data (encrypted)
 */
export const OpenClawPairingDataSchema = z.object({
    deviceId: z.string(),
    publicKey: z.string(),   // Base64URL encoded Ed25519 public key
    privateKey: z.string(),  // Base64URL encoded Ed25519 private key
    deviceToken: z.string().optional(),  // Token issued after successful pairing
});

export type OpenClawPairingData = z.infer<typeof OpenClawPairingDataSchema>;

/**
 * OpenClaw direct connection config (encrypted)
 */
export const OpenClawDirectConfigSchema = z.object({
    url: z.string(),
    password: z.string().optional(),
    token: z.string().optional(),
});

export type OpenClawDirectConfig = z.infer<typeof OpenClawDirectConfigSchema>;

/**
 * OpenClaw machine stored in the app
 */
export interface OpenClawMachine {
    id: string;
    type: 'happy' | 'direct';

    // type='happy' - Reference to Happy machine for relay
    happyMachineId: string | null;
    // type='happy' - Gateway auth token for tunnel mode (optional)
    gatewayToken: string | null;

    // type='direct' - Direct connection config (decrypted)
    directConfig: OpenClawDirectConfig | null;

    // General metadata (decrypted)
    metadata: OpenClawMetadata | null;
    metadataVersion: number;

    // Pairing data (decrypted)
    pairingData: OpenClawPairingData | null;

    seq: number;
    createdAt: number;
    updatedAt: number;
}

// === Protocol Types ===

/**
 * OpenClaw connection status
 */
export type OpenClawConnectionStatus =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'pairing_required'
    | 'error';

/**
 * OpenClaw protocol frame types
 */
export interface OpenClawRequestFrame {
    type: 'req';
    id: string;
    method: string;
    params?: unknown;
}

export interface OpenClawResponseFrame {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: unknown;
    error?: { code: string; message: string };
}

export interface OpenClawEventFrame {
    type: 'event';
    event: string;
    payload?: unknown;
    payloadJSON?: string;
    seq?: number;
}

export type OpenClawFrame = OpenClawRequestFrame | OpenClawResponseFrame | OpenClawEventFrame;

/**
 * OpenClaw session
 */
export interface OpenClawSession {
    key: string;
    kind: 'direct' | 'group' | 'global' | 'unknown';
    label?: string;
    displayName?: string;
    surface?: string;
    subject?: string;
    room?: string;
    space?: string;
    updatedAt: number | null;
    sessionId?: string;
    systemSent?: boolean;
    abortedLastRun?: boolean;
    thinkingLevel?: string;
    verboseLevel?: string;
    reasoningLevel?: string;
    elevatedLevel?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    contextTokens?: number;
}

// === Content Block Types ===

export interface TextContentBlock {
    type: 'text';
    text: string;
    textSignature?: string;
}

export interface ThinkingContentBlock {
    type: 'thinking';
    thinking: string;
}

export interface ToolCallContentBlock {
    type: 'toolcall' | 'tool_call' | 'tool_use' | 'tooluse';
    id?: string;
    name?: string;
    arguments?: unknown;
    input?: unknown;       // Anthropic API uses 'input' instead of 'arguments'
    args?: unknown;        // Another variant
    locations?: Array<{ path: string; line?: number }>;
}

export interface ToolResultContentBlock {
    type: 'tool_result' | 'toolresult';
    id?: string;
    tool_use_id?: string;  // Anthropic API variant
    toolUseId?: string;    // camelCase variant
    name?: string;
    content?: string | Array<{ type: string; text?: string }>;
    is_error?: boolean;
    isError?: boolean;     // camelCase variant
}

export interface ImageContentBlock {
    type: 'image';
    data?: string;
    mimeType?: string;
    source?: { type?: string; media_type?: string; data?: string };
    omitted?: boolean;     // Gateway strips image data in history
    bytes?: number;        // Original data size when omitted
}

export type OpenClawContentBlock =
    | TextContentBlock
    | ThinkingContentBlock
    | ToolCallContentBlock
    | ToolResultContentBlock
    | ImageContentBlock;

// === Message Types ===

/**
 * OpenClaw chat message — matches gateway transcript format.
 * Role can be 'user', 'assistant', or tool-related roles for standalone tool result messages.
 */
export interface OpenClawChatMessage {
    role: 'user' | 'assistant' | 'toolResult' | 'tool_result' | 'toolresult' | 'tool' | 'function';
    content: OpenClawContentBlock[] | string;
    timestamp?: number;
    stopReason?: string;
    errorMessage?: string;
    phase?: 'commentary' | 'final_answer';
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    model?: string;
    // Fields for role='toolResult' messages
    toolCallId?: string;
    tool_call_id?: string;
    toolName?: string;
    tool_name?: string;
    isError?: boolean;
}

/**
 * OpenClaw chat event — matches gateway ChatEventSchema
 */
export interface OpenClawChatEvent {
    runId: string;
    sessionKey: string;
    seq: number;
    state: 'delta' | 'final' | 'aborted' | 'error';
    message?: OpenClawChatMessage;
    errorMessage?: string;
    errorKind?: 'refusal' | 'timeout' | 'rate_limit' | 'context_length' | 'unknown';
    usage?: unknown;
    stopReason?: string;
}

/**
 * OpenClaw tool stream event — from agent stream: "tool"
 */
export interface OpenClawToolStreamEvent {
    sessionKey: string;
    runId?: string;
    toolCallId: string;
    phase: 'start' | 'update' | 'result';
    name?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
}
