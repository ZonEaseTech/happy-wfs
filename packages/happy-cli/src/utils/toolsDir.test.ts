/**
 * The tools resolver has two implementations — this one and the CommonJS copy
 * inside scripts/ripgrep_launcher.cjs, which runs as its own subprocess and
 * cannot import ESM. If they disagree on the sidecar package name, ripgrep
 * silently falls back to the system binary (or to a mock) while difftastic
 * keeps working, so nothing visibly breaks and the drift goes unnoticed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyToolsDir, resolveToolsDir, toolPath, toolsPackageName, toolsPlatform } from './toolsDir';

describe('tools directory resolution', () => {
    it('names the sidecar after the running platform', () => {
        expect(toolsPlatform()).toBe(`${process.arch}-${process.platform}`);
        expect(toolsPackageName()).toBe(`@zonease/happy-tools-${process.arch}-${process.platform}`);
    });

    it('falls back to the pre-sidecar layout when no sidecar is installed', () => {
        // The sidecars are not a devDependency, so this repo exercises the
        // fallback — the same path an install made before the split takes.
        expect(resolveToolsDir()).toBe(legacyToolsDir());
        expect(legacyToolsDir().endsWith(resolve('tools', 'unpacked'))).toBe(true);
    });

    it('appends .exe only on Windows', () => {
        const expected = process.platform === 'win32' ? 'difft.exe' : 'difft';
        expect(toolPath('difft').endsWith(expected)).toBe(true);
    });

    it('keeps the CommonJS launcher on the same package name and fallback', () => {
        const launcher = readFileSync(resolve(__dirname, '../../scripts/ripgrep_launcher.cjs'), 'utf8');
        expect(launcher).toContain('@zonease/happy-tools-${process.arch}-${process.platform}');
        expect(launcher).toContain("path.join(__dirname, '..', 'tools', 'unpacked')");
    });
});
