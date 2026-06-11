import { isModelModeForAgent, MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';
import { CODEX_COPY_SESSION_MODEL_MODE } from './copySessionDefaults';

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini';

export const CLAUDE_NEW_SESSION_DEFAULT_MODEL = 'claude-opus-4-8[1m]' satisfies ModelMode;

export function getInitialNewSessionModelMode(
    agentType: NewSessionAgentType,
    lastUsedModelMode: string | null | undefined,
): ModelMode {
    if (lastUsedModelMode && isModelModeForAgent(agentType, lastUsedModelMode)) {
        return lastUsedModelMode;
    }
    if (agentType === 'claude') {
        return CLAUDE_NEW_SESSION_DEFAULT_MODEL;
    }
    if (agentType === 'codex') {
        return CODEX_COPY_SESSION_MODEL_MODE;
    }
    return MODEL_MODE_DEFAULT;
}
