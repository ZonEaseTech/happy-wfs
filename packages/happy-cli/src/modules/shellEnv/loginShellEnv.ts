/**
 * The user's shell environment, resolved once for commands the daemon runs.
 *
 * launchd and systemd start the daemon with a bare environment — on macOS that
 * is PATH=/usr/bin:/bin:/usr/sbin:/sbin and nothing else. Anything the user set
 * up in .zshrc / .bash_profile (homebrew, nvm, pyenv, and happy's own runtime)
 * is therefore invisible to remote commands, even though the very same command
 * typed into the device terminal works: that terminal spawns an interactive
 * shell, which reads the rc files itself.
 *
 * Running the rc files per command would be slow and would let shell banners
 * leak into stdout, which the assistant parses. So ask an interactive login
 * shell once to hand back its environment, and reuse it.
 */

import { execFile } from 'node:child_process';
import { logger } from '@/ui/logger';

/** Bounds a shell whose rc files are slow, or that waits on input despite the closed stdin. */
const RESOLVE_TIMEOUT_MS = 10_000;

/** Printed before the dump so rc-file output can be discarded. */
const MARKER = '__happy_shell_env__';

/**
 * The dump is JSON from our own node rather than `env`, because environment
 * values may contain newlines and `env` gives no way to tell those apart from
 * record separators. Everything before the last marker is rc-file noise.
 */
export function parseEnvDump(output: string): NodeJS.ProcessEnv | null {
    const markerAt = output.lastIndexOf(MARKER);
    if (markerAt < 0) return null;
    const jsonAt = output.indexOf('{', markerAt + MARKER.length);
    if (jsonAt < 0) return null;
    try {
        const parsed = JSON.parse(output.slice(jsonAt));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as NodeJS.ProcessEnv;
    } catch {
        return null;
    }
}

function dumpCommand(nodePath: string): string {
    const escapedNode = nodePath.replace(/'/g, `'\\''`);
    return `printf '%s' '${MARKER}'; '${escapedNode}' -e 'process.stdout.write(JSON.stringify(process.env))'`;
}

function runLoginShell(shell: string): Promise<NodeJS.ProcessEnv | null> {
    return new Promise((resolve) => {
        // -l reads the profile files, -i reads the rc files; users put PATH in
        // both depending on the shell and the guide they followed.
        const child = execFile(
            shell,
            ['-l', '-i', '-c', dumpCommand(process.execPath)],
            { timeout: RESOLVE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
            (error, stdout) => {
                // An rc file that fails still usually exports PATH first, so the
                // dump is worth parsing even on a non-zero exit.
                const parsed = parseEnvDump(stdout ?? '');
                if (!parsed && error) {
                    logger.debug('[shellEnv] login shell did not return an environment:', error.message);
                }
                resolve(parsed);
            },
        );
        // Nothing should be able to block on stdin.
        child.stdin?.end();
    });
}

/**
 * Variables the daemon owns, which must survive the merge: HAPPY_* configure
 * this process and the login shell cannot know them, and the colour switches
 * are what keep command output plain enough for the assistant to parse.
 */
const DAEMON_OWNED = /^(?:HAPPY_|NO_COLOR$|NODE_DISABLE_COLORS$)/;

export function daemonOwnedEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(process.env).filter(([key]) => DAEMON_OWNED.test(key)));
}

let cached: Promise<NodeJS.ProcessEnv> | null = null;

/**
 * Resolves the login shell environment, falling back to the daemon's own so a
 * missing or broken shell never stops a command from running.
 */
export function resolveLoginShellEnv(): Promise<NodeJS.ProcessEnv> {
    if (cached) return cached;
    cached = (async () => {
        if (process.platform === 'win32') return process.env;
        const shell = process.env.SHELL;
        if (!shell) return process.env;
        const resolved = await runLoginShell(shell);
        if (!resolved) return process.env;
        logger.debug(`[shellEnv] resolved ${Object.keys(resolved).length} variables from ${shell}`);
        return { ...resolved, ...daemonOwnedEnv() };
    })();
    return cached;
}
