import { describe, expect, it } from 'vitest';
import { MODEL_MODE_DEFAULT } from 'happy-wire';

import { CLAUDE_NEW_SESSION_DEFAULT_MODEL, getInitialNewSessionModelMode } from './newSessionDefaults';

describe('new session model defaults', () => {
    it('defaults new Claude sessions to Opus 4.8 1M when no last-used model exists', () => {
        expect(CLAUDE_NEW_SESSION_DEFAULT_MODEL).toBe('claude-opus-4-8[1m]');
        expect(getInitialNewSessionModelMode('claude', null)).toBe('claude-opus-4-8[1m]');
    });

    it('keeps a valid last-used Claude model instead of overriding it', () => {
        expect(getInitialNewSessionModelMode('claude', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    });

    it('keeps non-Claude agents on CLI default without a last-used model', () => {
        expect(getInitialNewSessionModelMode('codex', null)).toBe(MODEL_MODE_DEFAULT);
        expect(getInitialNewSessionModelMode('gemini', null)).toBe(MODEL_MODE_DEFAULT);
    });

    it('falls back per agent when the saved model belongs to another agent', () => {
        expect(getInitialNewSessionModelMode('claude', 'gpt-5.5-high')).toBe('claude-opus-4-8[1m]');
        expect(getInitialNewSessionModelMode('codex', 'claude-opus-4-8[1m]')).toBe(MODEL_MODE_DEFAULT);
    });
});
