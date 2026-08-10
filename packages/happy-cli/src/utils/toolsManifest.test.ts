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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const { PLATFORMS, TOOLS_PACKAGE_VERSION, sidecarManifest } = createRequire(import.meta.url)('../../scripts/build-tool-packages.cjs');

const repoRoot = resolve(__dirname, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('platform tool packages', () => {
    it('are absent from the committed manifest', () => {
        // Read from git, not the working tree: the publish step injects the
        // dependency before `npm publish`, which runs this suite through
        // prepublishOnly. The invariant is about what is committed.
        const committed = JSON.parse(
            execFileSync('git', ['show', 'HEAD:packages/happy-cli/package.json'], {
                cwd: resolve(repoRoot, '../..'),
                encoding: 'utf8',
            }),
        );
        expect(committed.optionalDependencies).toBeUndefined();
        expect(committed.files).not.toContain('tools');
    });

    it('are injected by the publish workflow', () => {
        const workflow = read('../../.github/workflows/cli-publish.yml');
        expect(workflow).toContain('build-tool-packages.cjs --write-optional-deps');
        // Ordering matters: the CLI manifest pins exact versions.
        expect(workflow.indexOf('Publish platform tool packages'))
            .toBeLessThan(workflow.indexOf('Publish to npm'));
    });

    it('cover every platform the unpacker knows about', () => {
        expect(PLATFORMS).toEqual(
            expect.arrayContaining(['arm64-darwin', 'x64-darwin', 'arm64-linux', 'x64-linux', 'x64-win32', 'arm64-win32']),
        );
        expect(PLATFORMS).toHaveLength(6);
    });

    it('carry what npm provenance requires', () => {
        // A missing repository.url is a 422 at publish time and nowhere earlier;
        // it cost a release here.
        const manifest = sidecarManifest('x64-linux');
        expect(manifest.repository?.url).toBe(JSON.parse(read('package.json')).repository.url);
        expect(manifest.name).toBe('@zonease/happy-tools-x64-linux');
        expect(manifest.version).toBe(TOOLS_PACKAGE_VERSION);
    });

    it('tag each sidecar so npm installs only the matching one', () => {
        expect(sidecarManifest('arm64-darwin')).toMatchObject({ os: ['darwin'], cpu: ['arm64'] });
        expect(sidecarManifest('x64-win32')).toMatchObject({ os: ['win32'], cpu: ['x64'] });
    });
});
