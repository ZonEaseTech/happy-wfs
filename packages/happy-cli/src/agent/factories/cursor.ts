/**
 * Cursor CLI Backend Factory
 *
 * Factory for a backend driven by the Cursor CLI's stream-json print mode.
 * The `cursor-agent` binary must be on PATH and authenticated
 * (`cursor-agent login`, or CURSOR_API_KEY in the environment).
 */

import { CursorCliBackend, type CursorCliBackendOptions } from '@/cursor/CursorCliBackend';
import type { AgentBackend, AgentFactoryOptions } from '../core';
import { agentRegistry } from '../core';
import { logger } from '@/ui/logger';

export interface CursorBackendOptions extends AgentFactoryOptions {
    /** Model id from `cursor-agent --list-models`; null leaves it to Cursor */
    model?: string | null;
    /** Override the executable, for tests or non-standard installs */
    command?: string;
    /** Extra CLI flags */
    extraArgs?: string[];
}

export interface CursorBackendResult {
    backend: AgentBackend;
    /** Resolved model that will be used (null = Cursor's own default) */
    model: string | null;
}

export function createCursorBackend(options: CursorBackendOptions): CursorBackendResult {
    const model = options.model ?? process.env.CURSOR_MODEL ?? null;

    const backendOptions: CursorCliBackendOptions = {
        cwd: options.cwd,
        env: options.env,
        model,
        command: options.command,
        extraArgs: options.extraArgs,
    };

    logger.debug('[cursor] Creating CLI backend', {
        cwd: backendOptions.cwd,
        model: model ?? '(Cursor CLI default)',
    });

    return {
        backend: new CursorCliBackend(backendOptions),
        model,
    };
}

/**
 * Register the Cursor backend with the global agent registry.
 */
export function registerCursorAgent(): void {
    agentRegistry.register('cursor', (opts) => createCursorBackend(opts as CursorBackendOptions).backend);
    logger.debug('[cursor] Registered with agent registry');
}
