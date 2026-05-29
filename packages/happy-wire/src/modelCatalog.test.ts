import { describe, expect, it } from 'vitest';
import {
    buildClaudeModelMode,
    buildCodexModelMode,
    CODEX_MODEL_FAMILY_OPTIONS,
    CLAUDE_MODEL_FAMILY_OPTIONS,
    CODEX_MODEL_MODES,
    getClaudeReasoningOptions,
    getCodexReasoningOptions,
    getMaxContextSize,
    isModelMode,
    isModelModeForAgent,
    MODEL_MODE_DEFAULT,
    parseClaudeModelMode,
    parseCodexModelMode,
    resolveModelSelectionForFlavor,
} from './modelCatalog';

describe('modelCatalog', () => {
    it('validates model mode and flavor-specific mode', () => {
        expect(isModelMode('gpt-5.3-codex-xhigh')).toBe(true);
        expect(isModelMode('unknown-model')).toBe(false);

        expect(isModelModeForAgent('codex', 'gpt-5.3-codex-xhigh')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gpt-5.3-codex-xhigh')).toBe(false);
        expect(isModelModeForAgent('claude', 'claude-opus-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8[1m]')).toBe(true);
    });


    it('hides lower-tier Claude families from the picker while preserving mode compatibility', () => {
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-sonnet-4-6');
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-sonnet-4-6[1m]');
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-haiku-4-5');
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-opus-4-6');
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-opus-4-6[1m]');
        expect(isModelModeForAgent('claude', 'claude-opus-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-6[1m]')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-sonnet-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-haiku-4-5')).toBe(true);
    });

    it('supports Claude Opus 4.8 1M model modes', () => {
        expect(isModelMode('claude-opus-4-8[1m]-max')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8[1m]-max')).toBe(true);
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.find(option => option.value === 'claude-opus-4-8[1m]')?.label).toBe('Claude Opus 4.8 (1M)');
        expect(parseClaudeModelMode('claude-opus-4-8[1m]-max')).toEqual({
            family: 'claude-opus-4-8[1m]',
            effort: 'max',
        });
        expect(buildClaudeModelMode('claude-opus-4-8[1m]', 'high')).toBe('claude-opus-4-8[1m]-high');
        expect(getClaudeReasoningOptions('claude-opus-4-8[1m]')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-4-8[1m]-max')).toEqual({
            model: 'claude-opus-4-8[1m]',
            reasoningEffort: 'max',
        });
        expect(getMaxContextSize('claude-opus-4-8[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8[1m]-high', 'claude')).toBe(1_000_000);
    });

    it('parses codex model mode into family and effort', () => {
        expect(parseCodexModelMode('gpt-5.2-medium')).toEqual({
            family: 'gpt-5.2',
            effort: 'medium',
        });
        expect(parseCodexModelMode('claude-opus-4-6')).toEqual({
            family: MODEL_MODE_DEFAULT,
            effort: 'medium',
        });
    });

    it('builds codex model mode with mini fallback and default', () => {
        expect(buildCodexModelMode('gpt-5.1-codex-mini', 'low')).toBe('gpt-5.1-codex-mini-medium');
        expect(buildCodexModelMode('gpt-5.3-codex', 'xhigh')).toBe('gpt-5.3-codex-xhigh');
        expect(buildCodexModelMode(MODEL_MODE_DEFAULT, 'high')).toBe(MODEL_MODE_DEFAULT);
    });

    it('returns valid reasoning options per codex family', () => {
        expect(getCodexReasoningOptions('gpt-5.1-codex-mini')).toEqual(['high', 'medium']);
        expect(getCodexReasoningOptions('gpt-5.3-codex')).toEqual(['xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions(MODEL_MODE_DEFAULT)).toEqual(['high', 'medium', 'low']);
    });

    it('resolves session model selection payload for each flavor', () => {
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.2-codex-high')).toEqual({
            model: 'gpt-5.2-codex',
            reasoningEffort: 'high',
        });
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-4-5')).toEqual({
            model: 'claude-opus-4-5',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('gemini', 'gemini-2.5-pro')).toEqual({
            model: 'gemini-2.5-pro',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', MODEL_MODE_DEFAULT)).toEqual({
            model: null,
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', 'custom-model-id')).toEqual({
            model: 'custom-model-id',
            reasoningEffort: null,
        });
    });

    it('hides older Codex families from the picker while preserving mode compatibility', () => {
        const values = CODEX_MODEL_FAMILY_OPTIONS.map(option => option.value);
        expect(values).toEqual([MODEL_MODE_DEFAULT, 'gpt-5.5', 'gpt-5.4']);
        expect(isModelModeForAgent('codex', 'gpt-5.3-codex-xhigh')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.2-high')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.1-codex-mini-high')).toBe(true);
    });

    it('keeps codex model list in catalog shape', () => {
        expect(CODEX_MODEL_MODES[0]).toBe(MODEL_MODE_DEFAULT);
        expect(CODEX_MODEL_MODES).toContain('gpt-5.1-codex-mini-high');
    });

    it('resolves context windows for claude composite and fast model modes', () => {
        expect(getMaxContextSize('claude-opus-4-6-high', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6-fast', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6', 'claude')).toBe(200_000);
        // 1M context variants
        expect(getMaxContextSize('claude-opus-4-6[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6[1m]-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-sonnet-4-6[1m]', 'claude')).toBe(1_000_000);
    });

    it('resolves context window from actualModel when modelMode is default', () => {
        // Exact match
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6')).toBe(200_000);
        // SDK date-stamped model ID (prefix match)
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-20250514')).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-1-20250805')).toBe(200_000);
        // -fast suffix
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6-fast')).toBe(200_000);
        // Codex actual model
        expect(getMaxContextSize('default', 'codex', 'gpt-5.2-codex')).toBe(258_400);
        // Gemini actual model
        expect(getMaxContextSize('default', 'gemini', 'gemini-2.5-pro')).toBe(1_000_000);
        // Unknown model falls back to agent default
        expect(getMaxContextSize('default', 'claude', 'some-unknown-model')).toBe(200_000);
        // No actualModel falls back to agent default
        expect(getMaxContextSize('default', 'claude')).toBe(200_000);
        expect(getMaxContextSize('default', 'gemini')).toBe(1_000_000);
    });
});
