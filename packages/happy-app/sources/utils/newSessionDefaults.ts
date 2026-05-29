import { isModelModeForAgent, MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';

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
    return MODEL_MODE_DEFAULT;
}
