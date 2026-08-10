/**
 * Argument parsing decides between opening a shell and running a command, and
 * both failure directions are bad: a missed `--` drops the user into an
 * interactive PTY that hangs a script, and a mangled command runs something
 * other than what was typed on someone's production box.
 */

import { describe, expect, it } from 'vitest';
import { parseSshArgs } from './ssh';

describe('parseSshArgs', () => {
    it('opens a shell when no command is given', () => {
        expect(parseSshArgs(['mac mini'])).toMatchObject({ target: 'mac mini', command: null });
        expect(parseSshArgs([])).toMatchObject({ target: null, command: null });
    });

    it('takes everything after -- as the command', () => {
        const parsed = parseSshArgs(['mac mini', '--', 'git', 'pull']);
        expect(parsed.target).toBe('mac mini');
        expect(parsed.command).toBe('git pull');
    });

    it('keeps a quoted multi-line script intact', () => {
        // The shell hands a quoted block over as one argv entry.
        const script = 'set -e\ncd /Users/me/repo\ngit pull';
        expect(parseSshArgs(['mac mini', '--', script]).command).toBe(script);
    });

    it('treats an empty command after -- as no command', () => {
        // Otherwise `happy ssh dev --` would run an empty string and report
        // success without doing anything.
        expect(parseSshArgs(['dev', '--']).command).toBeNull();
        expect(parseSshArgs(['dev', '--', '   ']).command).toBeNull();
    });

    it('reads --timeout in seconds and keeps it out of the target', () => {
        const parsed = parseSshArgs(['--timeout', '900', 'mac mini', '--', 'git pull']);
        expect(parsed.timeoutMs).toBe(900_000);
        expect(parsed.target).toBe('mac mini');
    });

    it('ignores a nonsense timeout rather than sending 0 or NaN', () => {
        // A zero or NaN timeout reaches the device and kills the child at once.
        expect(parseSshArgs(['-t', 'soon', 'dev', '--', 'ls']).timeoutMs).toBe(300_000);
        expect(parseSshArgs(['-t', '0', 'dev', '--', 'ls']).timeoutMs).toBe(300_000);
    });

    it('does not mistake a flag inside the command for the target', () => {
        const parsed = parseSshArgs(['dev', '--', '--version']);
        expect(parsed.target).toBe('dev');
        expect(parsed.command).toBe('--version');
    });
});
