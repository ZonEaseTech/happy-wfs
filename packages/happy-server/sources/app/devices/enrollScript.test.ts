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
        expect(install).toContain('@zonease/happy@latest');
    });

    it('keeps the runtime private to the happy home directory', () => {
        expect(script).toContain('RUNTIME_DIR="$HAPPY_HOME_DIR/runtime"');
        expect(script).toContain('--prefix "$RUNTIME_DIR"');
    });

    it('carries the server url through so a self-hosted device reconnects', () => {
        expect(script).toContain('https://api.example.com');
    });
});
