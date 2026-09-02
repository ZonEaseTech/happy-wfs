import { describe, expect, it } from 'vitest';
import {
    buildClaudeModelMode,
    buildCodexModelMode,
    CODEX_MODEL_FAMILY_OPTIONS,
    CLAUDE_MODEL_OPTIONS,
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
    CURSOR_MODEL_MODES,
    CURSOR_MODEL_OPTIONS,
    getValidModelModesForAgent,
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

    it('supports Claude Fable 5.1 and 1M model modes in Claude pickers', () => {
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value).slice(1, 3)).toEqual([
            'claude-fable-5-1',
            'claude-fable-5-1[1m]',
        ]);
        expect(CLAUDE_MODEL_OPTIONS.map(option => option.value).slice(1, 3)).toEqual([
            'claude-fable-5-1[1m]',
            'claude-fable-5-1',
        ]);
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.find(option => option.value === 'claude-fable-5-1')?.label).toBe('Claude Fable 5.1');
        expect(isModelMode('claude-fable-5-1-max')).toBe(true);
        expect(isModelMode('claude-fable-5-1[1m]-max')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-fable-5-1[1m]-max')).toBe(true);
        expect(parseClaudeModelMode('claude-fable-5-1[1m]-max')).toEqual({
            family: 'claude-fable-5-1[1m]',
            effort: 'max',
        });
        expect(buildClaudeModelMode('claude-fable-5-1[1m]', 'xhigh')).toBe('claude-fable-5-1[1m]-xhigh');
        expect(getClaudeReasoningOptions('claude-fable-5-1[1m]')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(resolveModelSelectionForFlavor('claude', 'claude-fable-5-1[1m]-max')).toEqual({
            model: 'claude-fable-5-1[1m]',
            reasoningEffort: 'max',
        });
        expect(getMaxContextSize('claude-fable-5-1[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-fable-5-1[1m]-high', 'claude')).toBe(1_000_000);
    });

    it('hides Claude Fable 5 from the picker while preserving mode compatibility', () => {
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-fable-5');
        expect(CLAUDE_MODEL_FAMILY_OPTIONS.map(option => option.value)).not.toContain('claude-fable-5[1m]');
        expect(CLAUDE_MODEL_OPTIONS.map(option => option.value)).not.toContain('claude-fable-5');
        expect(CLAUDE_MODEL_OPTIONS.map(option => option.value)).not.toContain('claude-fable-5[1m]');
        expect(isModelModeForAgent('claude', 'claude-fable-5')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-fable-5[1m]-max')).toBe(true);
        expect(parseClaudeModelMode('claude-fable-5[1m]-max')).toEqual({
            family: 'claude-fable-5[1m]',
            effort: 'max',
        });
        expect(getMaxContextSize('claude-fable-5[1m]-high', 'claude')).toBe(1_000_000);
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
        expect(values).toEqual([MODEL_MODE_DEFAULT, 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
        expect(isModelModeForAgent('codex', 'gpt-5.4-high')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.3-codex-xhigh')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.2-high')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.1-codex-mini-high')).toBe(true);
    });

    it('supports the gpt-5.6 sol/terra/luna families end to end', () => {
        expect(isModelModeForAgent('codex', 'gpt-5.6-sol-max')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.6-terra-high')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-5.6-luna-medium')).toBe(true);
        expect(parseCodexModelMode('gpt-5.6-sol-max')).toEqual({ family: 'gpt-5.6-sol', effort: 'max' });
        expect(parseCodexModelMode('gpt-5.6-terra-high')).toEqual({ family: 'gpt-5.6-terra', effort: 'high' });
        expect(buildCodexModelMode('gpt-5.6-sol', 'max')).toBe('gpt-5.6-sol-max');
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.6-luna-medium')).toEqual({
            model: 'gpt-5.6-luna',
            reasoningEffort: 'medium',
        });
    });

    it('restricts the max reasoning effort to Sol', () => {
        expect(getCodexReasoningOptions('gpt-5.6-sol')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-terra')).toEqual(['xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-luna')).toEqual(['xhigh', 'high', 'medium', 'low']);
        expect(buildCodexModelMode('gpt-5.6-terra', 'max')).toBe('gpt-5.6-terra-xhigh');
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

describe('cursor flavor', () => {
    it('accepts only its own curated modes', () => {
        expect(isModelModeForAgent('cursor', 'composer-2.5')).toBe(true);
        expect(isModelModeForAgent('cursor', 'auto')).toBe(true);
        expect(isModelModeForAgent('cursor', 'gpt-5.6-sol-high')).toBe(true);
        // A valid Claude Code mode is not a valid Cursor mode.
        expect(isModelModeForAgent('cursor', 'claude-opus-5[1m]-max')).toBe(false);
        expect(isModelModeForAgent('cursor', 'not-a-model')).toBe(false);
    });

    it('offers the curated list, not all 161 Cursor ids', () => {
        expect(getValidModelModesForAgent('cursor')).toBe(CURSOR_MODEL_MODES);
        expect(CURSOR_MODEL_MODES.length).toBeLessThan(20);
        // Every picker option must be a mode the validator accepts.
        for (const option of CURSOR_MODEL_OPTIONS) {
            expect(isModelModeForAgent('cursor', option.value)).toBe(true);
        }
    });

    it('passes the id straight through, since Cursor ids already carry effort', () => {
        expect(resolveModelSelectionForFlavor('cursor', 'composer-2.5')).toEqual({
            model: 'composer-2.5',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('cursor', 'claude-opus-5-thinking-high')).toEqual({
            model: 'claude-opus-5-thinking-high',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('cursor', 'default')).toEqual({
            model: null,
            reasoningEffort: null,
        });
    });

    it('uses the conservative context floor, since the routed model is unknown', () => {
        expect(getMaxContextSize('default', 'cursor')).toBe(200_000);
        expect(getMaxContextSize('auto', 'cursor')).toBe(200_000);
    });
});
