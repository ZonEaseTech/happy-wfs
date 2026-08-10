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
const outArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const outRoot = path.resolve(outArg ?? path.join(root, 'tools', 'packages'));
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

/**
 * `npm publish --provenance` refuses the upload unless repository.url matches
 * the repo the attestation was signed from, and that only surfaces at publish
 * time — so the field is taken from the CLI manifest rather than restated here.
 */
function sidecarManifest(platform) {
    const { cpu, os } = splitPlatform(platform);
    return {
        name: `@zonease/happy-tools-${platform}`,
        version: TOOLS_PACKAGE_VERSION,
        description: `difftastic and ripgrep binaries for ${platform}, used by @zonease/happy`,
        license: 'MIT',
        repository: require(path.join(root, 'package.json')).repository,
        os: [os],
        cpu: [cpu],
        // Consumers resolve the directory from package.json and join a binary
        // name onto it, so no entry point is needed.
        files: ['*'],
    };
}

async function buildPackage(platform) {
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

    fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(sidecarManifest(platform), null, 2) + '\n');

    const size = fs.readdirSync(outDir)
        .map((entry) => fs.statSync(path.join(outDir, entry)).size)
        .reduce((total, bytes) => total + bytes, 0);
    console.log(`${platform.padEnd(14)} ${(size / 1048576).toFixed(1)} MB  ${outDir}`);
}

/**
 * The published manifest must depend on the sidecars, but the checked-in one
 * must not: yarn resolves optionalDependencies even with --ignore-optional, so
 * declaring them in the repo makes `yarn install` fail for everyone until they
 * exist on npm — including the very release that first publishes them. Inject
 * them at publish time instead.
 */
/**
 * Adds the sidecars to whatever optional dependencies already exist. Replacing
 * the object instead of merging dropped node-pty from a published release, and
 * every machine that upgraded lost its terminal — the CLI reported a native
 * build failure for a package that had simply never been installed.
 */
function optionalDependenciesWithSidecars(existing) {
    return {
        ...existing,
        ...Object.fromEntries(
            PLATFORMS.map((platform) => [`@zonease/happy-tools-${platform}`, TOOLS_PACKAGE_VERSION]),
        ),
    };
}

function writeOptionalDeps() {
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.optionalDependencies = optionalDependenciesWithSidecars(manifest.optionalDependencies);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\npackage.json now depends on ${PLATFORMS.length} tool packages @ ${TOOLS_PACKAGE_VERSION}`);
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
    if (process.argv.includes('--write-optional-deps')) {
        writeOptionalDeps();
    }
}

module.exports = { PLATFORMS, TOOLS_PACKAGE_VERSION, sidecarManifest, optionalDependenciesWithSidecars };

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
