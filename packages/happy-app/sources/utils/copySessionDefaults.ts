import { MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';
import type { Session } from '@/sync/storageTypes';

export type CopyTargetAgent = 'claude' | 'codex' | 'gemini' | 'cursor';

export const CODEX_COPY_SESSION_MODEL_MODE = 'gpt-6.1-sol-high' satisfies ModelMode;
// Same model a new Claude session starts on (CLAUDE_NEW_SESSION_DEFAULT_MODEL).
export const CLAUDE_COPY_SESSION_MODEL_MODE = 'claude-opus-5-5[1m]' satisfies ModelMode;

/**
 * Skip-all-permissions mode for an agent: Claude calls it `bypassPermissions`,
 * Codex, Gemini and Cursor call it `yolo`. Copied and resumed sessions start
 * here, and so do sessions shared with you until you pick a mode yourself.
 */
export function getYoloPermissionMode(agent: string | null | undefined): NonNullable<Session['permissionMode']> {
    return !agent || agent === 'claude' ? 'bypassPermissions' : 'yolo';
}

/**
 * The permission mode a message goes out with. Your own sessions fall back to
 * `default`; a session someone shared with you falls back to YOLO, so your
 * messages don't stall on approval prompts in their session.
 */
export function getSessionPermissionMode(session: Pick<Session, 'permissionMode' | 'accessLevel' | 'metadata'>): NonNullable<Session['permissionMode']> {
    return session.permissionMode || (session.accessLevel ? getYoloPermissionMode(session.metadata?.flavor) : 'default');
}

export function getCopyToAgentModelMode(targetAgent: CopyTargetAgent): ModelMode {
    if (targetAgent === 'codex') return CODEX_COPY_SESSION_MODEL_MODE;
    if (targetAgent === 'claude') return CLAUDE_COPY_SESSION_MODEL_MODE;
    return MODEL_MODE_DEFAULT;
}

export function getCopiedSessionModelMode(
    agentType: CopyTargetAgent,
    originalModelMode: string | null | undefined,
): ModelMode | string {
    if (!originalModelMode || originalModelMode === MODEL_MODE_DEFAULT) {
        if (agentType === 'codex') return CODEX_COPY_SESSION_MODEL_MODE;
        if (agentType === 'claude') return CLAUDE_COPY_SESSION_MODEL_MODE;
    }
    return originalModelMode || MODEL_MODE_DEFAULT;
}
