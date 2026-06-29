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


export type NewSessionPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'read-only' | 'safe-yolo' | 'yolo';

export const NEW_SESSION_FORCED_PERMISSION_MODE = 'yolo' satisfies NewSessionPermissionMode;

export function getInitialNewSessionPermissionMode(
    _lastUsedPermissionMode: string | null | undefined,
): NewSessionPermissionMode {
    return NEW_SESSION_FORCED_PERMISSION_MODE;
}
