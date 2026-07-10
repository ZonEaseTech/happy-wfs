import { trimIdent } from '@/utils/trimIdent';
import { ORCHESTRATOR_ENV_KEYS } from './common';

export const CHAT_TITLE_INSTRUCTION = trimIdent(`
  # Chat title

  On your first response, call "change_title" to set a descriptive title based on the user's message. Update the title whenever the conversation's main focus shifts to a different topic or task.
`);

export function isOrchestratorWorkerSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ORCHESTRATOR_ENV_KEYS.oneshot] === '1' || !!env[ORCHESTRATOR_ENV_KEYS.executionId];
}

/**
 * Orchestrator delegation is retired from AI sessions: no prompt section and
 * no orchestrator_* tools are exposed. Worker-session detection stays so
 * one-shot workers keep skipping the chat-title instruction.
 */
export function shouldEnableOrchestratorTools(): boolean {
  return false;
}

export function getBaseSystemPrompt(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isOrchestratorWorkerSession(env)) {
    return null;
  }
  return CHAT_TITLE_INSTRUCTION;
}
