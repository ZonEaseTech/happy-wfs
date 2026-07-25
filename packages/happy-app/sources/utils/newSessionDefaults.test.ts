import { describe, expect, it } from 'vitest';
import { CLAUDE_NEW_SESSION_DEFAULT_MODEL, getInitialNewSessionAgentType, getInitialNewSessionModelMode, getInitialNewSessionPermissionMode } from './newSessionDefaults';
import { CODEX_COPY_SESSION_MODEL_MODE } from './copySessionDefaults';

describe('new session model defaults', () => {
    it('defaults new Claude sessions to Opus 5 1M when no last-used model exists', () => {
        expect(CLAUDE_NEW_SESSION_DEFAULT_MODEL).toBe('claude-opus-5[1m]');
        expect(getInitialNewSessionModelMode('claude', null)).toBe('claude-opus-5[1m]');
    });

    it('keeps a valid last-used Claude model instead of overriding it', () => {
        expect(getInitialNewSessionModelMode('claude', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    });

    it('defaults new Codex sessions to GPT-5.5 high without a last-used model', () => {
        expect(getInitialNewSessionModelMode('codex', null)).toBe(CODEX_COPY_SESSION_MODEL_MODE);
    });

    it('keeps Gemini on CLI default without a last-used model', () => {
        expect(getInitialNewSessionModelMode('gemini', null)).toBe('default');
    });

    it('falls back per agent when the saved model belongs to another agent', () => {
        expect(getInitialNewSessionModelMode('claude', 'gpt-5.5-high')).toBe('claude-opus-5[1m]');
        expect(getInitialNewSessionModelMode('codex', 'claude-opus-4-8[1m]')).toBe(CODEX_COPY_SESSION_MODEL_MODE);
    });
});


describe('new session permission defaults', () => {
    it('forces new sessions to YOLO regardless of saved or profile permission mode', () => {
        expect(getInitialNewSessionPermissionMode(undefined)).toBe('yolo');
        expect(getInitialNewSessionPermissionMode('default')).toBe('yolo');
        expect(getInitialNewSessionPermissionMode('acceptEdits')).toBe('yolo');
        expect(getInitialNewSessionPermissionMode('read-only')).toBe('yolo');
    });
});

describe('new session agent defaults', () => {
    it('uses the selected top profile instead of temp agent data for the default agent', () => {
        expect(getInitialNewSessionAgentType(
            { compatibility: { claude: true, codex: false, gemini: false } },
            'codex',
        )).toBe('claude');
    });

    it('uses a Codex-only selected profile as the default agent', () => {
        expect(getInitialNewSessionAgentType(
            { compatibility: { claude: false, codex: true, gemini: false } },
            'claude',
        )).toBe('codex');
    });
});
