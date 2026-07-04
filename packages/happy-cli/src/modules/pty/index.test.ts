import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pty shell environment', () => {
    it('advertises color support for interactive terminal sessions', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');

        expect(source).toContain('delete shellEnv.NO_COLOR');
        expect(source).toContain('delete shellEnv.NODE_DISABLE_COLORS');
        expect(source).toContain("shellEnv.TERM = 'xterm-256color'");
        expect(source).toContain("shellEnv.COLORTERM = 'truecolor'");
        expect(source).toContain("shellEnv.FORCE_COLOR = shellEnv.FORCE_COLOR || '1'");
        expect(source).toContain("shellEnv.CLICOLOR = shellEnv.CLICOLOR || '1'");
    });

    it('installs a prompt that shows at most the last two path segments for bash PTYs', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');

        expect(source).toContain('createHappyBashRc');
        expect(source).toContain('local leaf="${dir##*/}"');
        expect(source).toContain('local parent_leaf="${parent##*/}"');
        expect(source).toContain('printf \'%s/%s\' \\"$parent_leaf\\" \\"$leaf\\"');
        expect(source).toContain('PS1="$(__happy_short_pwd)\\\\$ "');
        expect(source).toContain("['--rcfile', createHappyBashRc(), '-i']");
    });
});
