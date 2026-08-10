#!/usr/bin/env node

/**
 * Materializes one npm package per platform from tools/archives.
 *
 * The CLI used to ship all six platforms' binaries — a host downloaded 106MB of
 * archives it could never execute, then unpacked the matching one alongside
 * them. Publishing them as `os`/`cpu`-tagged sidecars lets npm fetch only the
 * one that matches, and shipping them already extracted means the bytes are not
 * stored twice.
 *
 * Usage: node scripts/build-tool-packages.cjs [outDir]
 * Output: <outDir>/<platform>/ ready for `npm publish`.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const tar = require('tar');

const PLATFORMS = [
    'arm64-darwin',
    'x64-darwin',
    'arm64-linux',
    'x64-linux',
    'x64-win32',
    'arm64-win32',
];

/**
 * Sidecars are versioned on their own, not with the CLI: the binaries only
 * change when download-tools.sh moves to a new upstream release, and tying them
 * to the CLI would re-upload ~128MB of identical bytes on every patch. Bump this
 * when TOOL_VERSIONS below changes.
 */
const TOOLS_PACKAGE_VERSION = '1.0.0';

/** Must match the pins in download-tools.sh; checked below so they cannot drift. */
const TOOL_VERSIONS = { difft: '0.67.0', rg: '15.1.0' };

const root = path.resolve(__dirname, '..');
const archivesDir = path.join(root, 'tools', 'archives');
const outRoot = path.resolve(process.argv[2] ?? path.join(root, 'tools', 'packages'));
const version = TOOLS_PACKAGE_VERSION;

/**
 * A silent mismatch would publish the old binaries under a version that claims
 * to carry the new ones, and nothing downstream would notice.
 */
function assertToolVersionsMatch() {
    const script = fs.readFileSync(path.join(__dirname, 'download-tools.sh'), 'utf8');
    for (const [tool, expected] of Object.entries(TOOL_VERSIONS)) {
        const found = script.match(new RegExp(`^${tool}_ver=(\\S+)`, 'm'))?.[1];
        if (found !== expected) {
            throw new Error(
                `download-tools.sh pins ${tool}_ver=${found}, this script expects ${expected}. `
                + `Update TOOL_VERSIONS and bump TOOLS_PACKAGE_VERSION (now ${TOOLS_PACKAGE_VERSION}).`,
            );
        }
    }
}

/** `arm64-darwin` is our own ordering; npm wants cpu and os separately. */
function splitPlatform(platform) {
    const [cpu, os] = platform.split('-');
    return { cpu, os };
}

async function extract(archivePath, destDir) {
    await new Promise((resolve, reject) => {
        fs.createReadStream(archivePath)
            .pipe(zlib.createGunzip())
            .pipe(tar.extract({ cwd: destDir, preserveMode: true, preserveOwner: false }))
            .on('finish', resolve)
            .on('error', reject);
    });
}

async function buildPackage(platform) {
    const { cpu, os } = splitPlatform(platform);
    const outDir = path.join(outRoot, platform);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    for (const tool of ['difftastic', 'ripgrep']) {
        const archive = path.join(archivesDir, `${tool}-${platform}.tar.gz`);
        if (!fs.existsSync(archive)) {
            throw new Error(`missing archive: ${archive} — run scripts/download-tools.sh ${platform}`);
        }
        await extract(archive, outDir);
        const license = path.join(archivesDir, `${tool}-LICENSE`);
        if (fs.existsSync(license)) {
            fs.copyFileSync(license, path.join(outDir, `${tool}-LICENSE`));
        }
    }

    // The archives carry their own modes, but npm pack does not always preserve
    // them across platforms; set them explicitly so difft/rg stay runnable.
    for (const entry of fs.readdirSync(outDir)) {
        const file = path.join(outDir, entry);
        if (fs.statSync(file).isFile() && !entry.endsWith('.node') && !entry.endsWith('LICENSE')) {
            fs.chmodSync(file, 0o755);
        }
    }

    fs.writeFileSync(
        path.join(outDir, 'package.json'),
        JSON.stringify({
            name: `@zonease/happy-tools-${platform}`,
            version,
            description: `difftastic and ripgrep binaries for ${platform}, used by @zonease/happy`,
            license: 'MIT',
            os: [os],
            cpu: [cpu],
            // Consumers resolve the directory from package.json and join a
            // binary name onto it, so no entry point is needed.
            files: ['*'],
        }, null, 2) + '\n',
    );

    const size = fs.readdirSync(outDir)
        .map((entry) => fs.statSync(path.join(outDir, entry)).size)
        .reduce((total, bytes) => total + bytes, 0);
    console.log(`${platform.padEnd(14)} ${(size / 1048576).toFixed(1)} MB  ${outDir}`);
}

async function main() {
    if (!fs.existsSync(archivesDir)) {
        throw new Error(`no archives at ${archivesDir} — run scripts/download-tools.sh all`);
    }
    assertToolVersionsMatch();
    fs.mkdirSync(outRoot, { recursive: true });
    for (const platform of PLATFORMS) {
        await buildPackage(platform);
    }
    console.log(`\n${PLATFORMS.length} packages at ${outRoot}, version ${version}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
