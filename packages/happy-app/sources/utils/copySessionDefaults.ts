import { MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';

export type CopyTargetAgent = 'claude' | 'codex' | 'gemini' | 'cursor';

export const CODEX_COPY_SESSION_MODEL_MODE = 'gpt-6.1-sol-high' satisfies ModelMode;
// Same model a new Claude session starts on (CLAUDE_NEW_SESSION_DEFAULT_MODEL).
export const CLAUDE_COPY_SESSION_MODEL_MODE = 'claude-opus-5-5[1m]' satisfies ModelMode;

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
