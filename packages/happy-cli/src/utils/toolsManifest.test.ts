/**
 * The dependency on the platform tool packages exists only in the published
 * manifest — the build script injects it at publish time, because yarn resolves
 * optionalDependencies even with --ignore-optional and would fail for everyone
 * until those packages exist on npm, including on the release that first
 * publishes them.
 *
 * Both halves of that arrangement fail silently. A checked-in dependency breaks
 * `yarn install` only on a fresh tools version; a publish step that stopped
 * injecting ships a CLI with no binaries at all, and nothing errors until
 * something reaches for ripgrep.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('platform tool packages', () => {
    it('are absent from the checked-in manifest', () => {
        const manifest = JSON.parse(read('package.json'));
        expect(manifest.optionalDependencies).toBeUndefined();
        expect(manifest.files).not.toContain('tools');
    });

    it('are injected by the publish workflow', () => {
        const workflow = read('../../.github/workflows/cli-publish.yml');
        expect(workflow).toContain('build-tool-packages.cjs --write-optional-deps');
        // Ordering matters: the CLI manifest pins exact versions.
        expect(workflow.indexOf('Publish platform tool packages'))
            .toBeLessThan(workflow.indexOf('Publish to npm'));
    });

    it('cover every platform the unpacker knows about', () => {
        const builder = read('scripts/build-tool-packages.cjs');
        for (const platform of ['arm64-darwin', 'x64-darwin', 'arm64-linux', 'x64-linux', 'x64-win32', 'arm64-win32']) {
            expect(builder).toContain(`'${platform}'`);
        }
    });
});
