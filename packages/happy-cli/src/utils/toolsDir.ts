/**
 * Where the bundled difft / rg binaries live.
 *
 * They used to ship inside this package as six platform archives — 106MB of
 * which any given host could never execute, plus the same bytes again once the
 * matching one was unpacked. They now ship as per-platform sidecar packages
 * listed in optionalDependencies, so npm fetches only the one that matches.
 *
 * Installs made before that change still have the old tools/unpacked layout, so
 * fall back to it rather than losing the tools on upgrade.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { projectPath } from '@/projectPath';

/** Matches the sidecar naming and the archive names in download-tools.sh. */
export function toolsPlatform(): string {
    return `${process.arch}-${process.platform}`;
}

export function toolsPackageName(): string {
    return `@zonease/happy-tools-${toolsPlatform()}`;
}

/** The pre-sidecar location, still used by dev builds and older installs. */
export function legacyToolsDir(): string {
    return resolve(projectPath(), 'tools', 'unpacked');
}

let cached: string | undefined;

/**
 * Always returns a path: with no sidecar and no legacy directory the callers
 * that probe for a binary report it missing, which is the same outcome as
 * before and better than forcing every call site to handle null.
 */
export function resolveToolsDir(): string {
    if (cached !== undefined) return cached;
    cached = findToolsDir();
    return cached;
}

function findToolsDir(): string {
    try {
        const manifest = createRequire(import.meta.url).resolve(`${toolsPackageName()}/package.json`);
        return dirname(manifest);
    } catch {
        // Sidecar not installed — either an older install or a platform we do
        // not publish binaries for.
    }
    return legacyToolsDir();
}

export function toolPath(binary: string): string {
    return join(resolveToolsDir(), process.platform === 'win32' ? `${binary}.exe` : binary);
}

/** Test seam: the resolver caches, and platform-dependent tests must not leak. */
export function resetToolsDirCache(): void {
    cached = undefined;
}

export function toolsDirExists(): boolean {
    return existsSync(resolveToolsDir());
}
