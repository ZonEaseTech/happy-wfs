/**
 * The dump parser is the fragile part: it has to survive whatever the user's rc
 * files print before the environment arrives. A parser that silently returns
 * null just falls back to the bare daemon PATH, which looks exactly like the
 * bug this module exists to fix, so the failure would be invisible.
 */

import { describe, expect, it } from 'vitest';
import { parseEnvDump } from './loginShellEnv';

const MARKER = '__happy_shell_env__';

function dump(env: Record<string, string>): string {
    return `${MARKER}${JSON.stringify(env)}`;
}

describe('parseEnvDump', () => {
    it('reads the environment that follows the marker', () => {
        expect(parseEnvDump(dump({ PATH: '/opt/homebrew/bin:/usr/bin' }))).toEqual({
            PATH: '/opt/homebrew/bin:/usr/bin',
        });
    });

    it('discards whatever the rc files printed first', () => {
        const noisy = [
            'Welcome to fish-like autosuggestions',
            'nvm: version 22.20.0',
            dump({ PATH: '/usr/bin', NVM_DIR: '/Users/me/.nvm' }),
        ].join('\n');
        expect(parseEnvDump(noisy)?.NVM_DIR).toBe('/Users/me/.nvm');
    });

    it('takes the last marker when an rc file echoes an earlier one', () => {
        const confusing = `${MARKER} something else\n${dump({ PATH: '/real' })}`;
        expect(parseEnvDump(confusing)?.PATH).toBe('/real');
    });

    it('keeps values that contain newlines intact', () => {
        const parsed = parseEnvDump(dump({ SSH_KEY: 'line-one\nline-two' }));
        expect(parsed?.SSH_KEY).toBe('line-one\nline-two');
    });

    it('returns null rather than a partial environment when the dump is unusable', () => {
        expect(parseEnvDump('command not found')).toBeNull();
        expect(parseEnvDump(`${MARKER}not json at all`)).toBeNull();
        expect(parseEnvDump(`${MARKER}{"PATH":`)).toBeNull();
    });
});
