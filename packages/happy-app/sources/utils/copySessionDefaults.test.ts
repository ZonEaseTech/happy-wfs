import { describe, expect, it } from 'vitest';
import { resolveModelSelectionForFlavor } from 'happy-wire';
import { getCopyToAgentModelMode, getCopiedSessionModelMode } from './copySessionDefaults';

describe('copySessionDefaults', () => {
    it('uses GPT-5.5 high when copying a session into Codex', () => {
        const mode = getCopyToAgentModelMode('codex');
        expect(mode).toBe('gpt-5.5-high');
        expect(resolveModelSelectionForFlavor('codex', mode)).toEqual({
            model: 'gpt-5.5',
            reasoningEffort: 'high',
        });
    });

    it('keeps existing default behavior for non-Codex copy targets', () => {
        expect(getCopyToAgentModelMode('claude')).toBe('default');
        expect(getCopyToAgentModelMode('gemini')).toBe('default');
    });

    it('normalizes copied Codex session default to GPT-5.5 high', () => {
        expect(getCopiedSessionModelMode('codex', undefined)).toBe('gpt-5.5-high');
        expect(getCopiedSessionModelMode('codex', 'default')).toBe('gpt-5.5-high');
        expect(getCopiedSessionModelMode('codex', 'gpt-5.4-high')).toBe('gpt-5.4-high');
    });

    it('preserves copied non-Codex session defaults', () => {
        expect(getCopiedSessionModelMode('claude', undefined)).toBe('default');
        expect(getCopiedSessionModelMode('gemini', 'default')).toBe('default');
    });
});
