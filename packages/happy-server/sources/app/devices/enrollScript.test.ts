/**
 * The enrollment one-liner is the only thing most production boxes ever run, so
 * what it downloads matters. Dropping --omit=optional would silently pull the
 * platform tool packages back in — ~142MB per machine for binaries an enrolled
 * device never executes — and nothing would fail, so no one would notice.
 */

import { describe, expect, it } from 'vitest';
import { buildEnrollScript } from './enrollScript';

const script = buildEnrollScript('https://api.example.com', 'https://app.example.com');

describe('enroll script', () => {
    it('installs the CLI without the platform tool packages', () => {
        const install = script.split('\n').find((line) => line.includes('npm" install'));
        expect(install).toBeDefined();
        expect(install).toContain('--omit=optional');
        // npm 10 ignores --omit=optional for a package named on the command
        // line, so this must stay a package.json-driven install: -g here would
        // silently pull ~143MB of binaries back onto every device.
        expect(install).not.toContain('-g');
        expect(install).toContain('--prefix "$CLI_DIR"');
        expect(script).toContain('"@zonease/happy": "latest"');
    });

    it('adds node-pty back, since omitting optionals also omits it', () => {
        // A device with no node-pty has no terminal, which is most of what a
        // device is for — and the CLI reports it as a failed native build,
        // pointing at compilers rather than at the missing install.
        expect(script).toContain('node-pty@$PTY_RANGE');
        // The range comes from the installed CLI so the two cannot drift.
        expect(script).toContain("optionalDependencies['node-pty']");
        const ptyInstall = script.split('\n').find((line) => line.includes('node-pty@$PTY_RANGE'));
        expect(ptyInstall).toContain('--omit=optional');
    });

    it('keeps a stable entry point under the private runtime', () => {
        expect(script).toContain('RUNTIME_DIR="$HAPPY_HOME_DIR/runtime"');
        expect(script).toContain('ln -sf "$CLI_DIR/node_modules/.bin/happy" "$RUNTIME_DIR/bin/happy"');
        expect(script).toContain('"$RUNTIME_DIR/bin/happy" device enroll');
    });

    it('carries the server url through so a self-hosted device reconnects', () => {
        expect(script).toContain('https://api.example.com');
    });
});
