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

/**
 * Build a `<user_memory>` block from rows the user saved via the happy-app
 * memory page. Returns '' when there are no rows so callers can `+` it
 * unconditionally.
 *
 * Format is intentionally minimal — bullet list inside an XML tag so the
 * downstream agent picks it up as a discrete section. Wrapped with a brief
 * instruction so the agent treats it as authoritative user context, not
 * just casual chatter.
 */
export function buildMemoryPromptBlock(rows: Array<{ content: string }>): string {
  if (!rows || rows.length === 0) return '';
  const items = rows
    .map(r => r.content?.trim())
    .filter((s): s is string => Boolean(s))
    .map(s => `- ${s.replace(/\n+/g, ' ').slice(0, 800)}`);
  if (items.length === 0) return '';
  return [
    '',
    '<user_memory>',
    'The user has saved the following persistent context. Treat it as authoritative facts about the user and their projects, and apply it across the conversation when relevant.',
    ...items,
    '</user_memory>',
  ].join('\n');
}
