import { describe, expect, it } from 'vitest';
import { resolveModelSelectionForFlavor } from 'happy-wire';
import { getCopyToAgentModelMode, getCopiedSessionModelMode, getSessionPermissionMode, getYoloPermissionMode } from './copySessionDefaults';
import { CLAUDE_NEW_SESSION_DEFAULT_MODEL } from './newSessionDefaults';

describe('copySessionDefaults', () => {
    it('uses GPT-6.1 Sol with high effort when copying a session into Codex', () => {
        const mode = getCopyToAgentModelMode('codex');
        expect(mode).toBe('gpt-6.1-sol-high');
        expect(resolveModelSelectionForFlavor('codex', mode)).toEqual({
            model: 'gpt-6.1-sol',
            reasoningEffort: 'high',
        });
    });

    it('uses Opus 5.5 when copying a session into Claude, the same model a new Claude session starts on', () => {
        expect(getCopyToAgentModelMode('claude')).toBe('claude-opus-5-5[1m]');
        expect(getCopyToAgentModelMode('claude')).toBe(CLAUDE_NEW_SESSION_DEFAULT_MODEL);
    });

    it('keeps the CLI default for other copy targets', () => {
        expect(getCopyToAgentModelMode('gemini')).toBe('default');
        expect(getCopyToAgentModelMode('cursor')).toBe('default');
    });

    it('normalizes copied Codex session default to GPT-6.1 Sol high', () => {
        expect(getCopiedSessionModelMode('codex', undefined)).toBe('gpt-6.1-sol-high');
        expect(getCopiedSessionModelMode('codex', 'default')).toBe('gpt-6.1-sol-high');
        expect(getCopiedSessionModelMode('codex', 'gpt-5.4-high')).toBe('gpt-5.4-high');
    });

    it('starts a copied Claude session without a model on Opus 5.5, and keeps a chosen one', () => {
        expect(getCopiedSessionModelMode('claude', undefined)).toBe('claude-opus-5-5[1m]');
        expect(getCopiedSessionModelMode('claude', 'default')).toBe('claude-opus-5-5[1m]');
        expect(getCopiedSessionModelMode('claude', 'claude-fable-5-2')).toBe('claude-fable-5-2');
    });

    it('preserves copied Gemini session defaults', () => {
        expect(getCopiedSessionModelMode('gemini', 'default')).toBe('default');
    });
});

describe('YOLO defaults for copied and shared sessions', () => {
    it('maps YOLO to bypassPermissions for Claude and to yolo for the other agents', () => {
        expect(getYoloPermissionMode('claude')).toBe('bypassPermissions');
        expect(getYoloPermissionMode(undefined)).toBe('bypassPermissions');
        expect(getYoloPermissionMode('codex')).toBe('yolo');
        expect(getYoloPermissionMode('gemini')).toBe('yolo');
        expect(getYoloPermissionMode('cursor')).toBe('yolo');
    });

    it('falls back to YOLO in a session shared with you, and to default in your own', () => {
        const shared = { accessLevel: 'edit' as const, metadata: { flavor: 'codex' } as any, permissionMode: undefined };
        expect(getSessionPermissionMode(shared)).toBe('yolo');
        expect(getSessionPermissionMode({ ...shared, metadata: { flavor: 'claude' } as any })).toBe('bypassPermissions');
        expect(getSessionPermissionMode({ ...shared, accessLevel: undefined })).toBe('default');
    });

    it('keeps a mode you picked yourself, shared or not', () => {
        expect(getSessionPermissionMode({ accessLevel: 'edit', metadata: null, permissionMode: 'plan' })).toBe('plan');
        expect(getSessionPermissionMode({ accessLevel: undefined, metadata: null, permissionMode: 'acceptEdits' })).toBe('acceptEdits');
    });
});
