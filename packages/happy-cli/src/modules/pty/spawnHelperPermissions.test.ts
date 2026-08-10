/**
 * Locks the rule that decides whether spawn-helper needs its exec bit restored.
 * Getting the mask backwards silently disarms the fix — the file stays
 * non-executable and the terminal keeps failing with "posix_spawnp failed".
 */

import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Mirrors the guard in loadNodePty's ensureSpawnHelperExecutable. */
function needsExecBit(path: string): boolean {
    return (statSync(path).mode & 0o111) === 0;
}

describe('spawn-helper exec bit detection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'happy-spawn-helper-'));

    it('flags a helper that lost its exec bit', () => {
        const path = join(dir, 'unreadable-helper');
        writeFileSync(path, 'binary');
        chmodSync(path, 0o644);
        expect(needsExecBit(path)).toBe(true);

        chmodSync(path, 0o755);
        expect(needsExecBit(path)).toBe(false);
    });

    it('leaves a helper that is executable only by its owner alone', () => {
        const path = join(dir, 'owner-only-helper');
        writeFileSync(path, 'binary');
        chmodSync(path, 0o700);
        expect(needsExecBit(path)).toBe(false);
    });
});
