import { describe, expect, it } from 'vitest';
import {
  getBaseSystemPrompt,
  isOrchestratorWorkerSession,
  shouldEnableOrchestratorTools,
} from './prompt';

describe('orchestrator prompt helpers', () => {
  it('detects worker session from oneshot marker', () => {
    expect(isOrchestratorWorkerSession({ HAPPY_ORCH_ONESHOT: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOrchestratorWorkerSession({ HAPPY_ORCH_EXECUTION_ID: 'exec_1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOrchestratorWorkerSession({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('never enables orchestrator tools — the feature is retired from sessions', () => {
    expect(shouldEnableOrchestratorTools()).toBe(false);
  });

  it('returns only the chat-title prompt for controller sessions', () => {
    const controller = getBaseSystemPrompt({} as NodeJS.ProcessEnv);
    expect(controller).toContain('# Chat title');
    expect(controller).not.toContain('# Orchestrator');
    expect(controller).not.toContain('orchestrator_');

    const worker = getBaseSystemPrompt({ HAPPY_ORCH_ONESHOT: '1' } as NodeJS.ProcessEnv);
    expect(worker).toBeNull();
  });
});
