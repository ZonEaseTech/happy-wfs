import { MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';

export type CopyTargetAgent = 'claude' | 'codex' | 'gemini';

export const CODEX_COPY_SESSION_MODEL_MODE = 'gpt-5.5-high' satisfies ModelMode;

export function getCopyToAgentModelMode(targetAgent: CopyTargetAgent): ModelMode {
    if (targetAgent === 'codex') return CODEX_COPY_SESSION_MODEL_MODE;
    return MODEL_MODE_DEFAULT;
}

export function getCopiedSessionModelMode(
    agentType: CopyTargetAgent,
    originalModelMode: string | null | undefined,
): ModelMode | string {
    if (agentType === 'codex' && (!originalModelMode || originalModelMode === MODEL_MODE_DEFAULT)) {
        return CODEX_COPY_SESSION_MODEL_MODE;
    }
    return originalModelMode || MODEL_MODE_DEFAULT;
}
