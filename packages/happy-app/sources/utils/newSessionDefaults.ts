import { isModelModeForAgent, MODEL_MODE_DEFAULT } from 'happy-wire';
import type { ModelMode } from 'happy-wire';
import { CODEX_COPY_SESSION_MODEL_MODE } from './copySessionDefaults';

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini' | 'cursor';
export type NewSessionProfileAgentCompatibility = Partial<Record<NewSessionAgentType, boolean>>;

// Used to infer an agent from a profile's exclusive compatibility: picking the
// Cursor entry in the profile list is what switches the session to Cursor.
const NEW_SESSION_AGENT_TYPES = ['claude', 'codex', 'gemini', 'cursor'] as const;

export const CLAUDE_NEW_SESSION_DEFAULT_MODEL = 'claude-opus-5[1m]' satisfies ModelMode;

export function getInitialNewSessionAgentType(
    selectedProfile: { compatibility?: NewSessionProfileAgentCompatibility } | null | undefined,
    fallbackAgentType: NewSessionAgentType,
): NewSessionAgentType {
    const supportedAgents = NEW_SESSION_AGENT_TYPES.filter(agent => selectedProfile?.compatibility?.[agent] === true);
    if (supportedAgents.length === 1) {
        return supportedAgents[0];
    }
    return fallbackAgentType;
}

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
