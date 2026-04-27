import { getCommitAttribution } from "./claudeSettings";
import { getBaseSystemPrompt } from '@/orchestrator/prompt';

/**
 * System prompt with conditional commit attribution based on Claude's settings.json configuration.
 * Supports both the new `attribution` object and deprecated `includeCoAuthoredBy` boolean.
 * Settings are read once on startup for performance.
 *
 * Returns '' for worker sessions (getBaseSystemPrompt returns null).
 */
export const systemPrompt = (() => {
  const base = getBaseSystemPrompt();
  if (base === null) return ''; // Worker session — no system prompt

  const attribution = getCommitAttribution();
  if (!attribution) return base;

  return base + '\n\n# Commit\n\nWhen making commit messages, add this footer:\n\n' + attribution;
})();

// User memories are NOT injected into the system prompt anymore (was a
// misdesign — pushed every memory to every session, polluting context).
// They now live in /memory and the user pastes one explicitly via the
// memory picker in AgentInput. ApiClient.listMemories stays for the
// happy-app side; cli no longer reads it.
