/**
 * One-off operator script: identify enrolled devices by name and upgrade their
 * Happy CLI. Requires a single approval in the app — the approval seals the
 * whole device directory, so one click covers every device.
 *
 * Usage: tsx scripts/device-upgrade.ts [--run <name-substring>]
 */

import { readCredentials } from '@/persistence';
import { listDevices, deviceExec } from '@/device/deviceExec';
import { ensureDeviceKey, readCachedDeviceNames } from '@/device/deviceKeys';
import { encodeBase64 } from '@/api/encryption';
import { io, type Socket } from 'socket.io-client';
import { configuration } from '@/configuration';

const UPGRADE = [
    '~/.happy/runtime/bin/npm install -g --prefix ~/.happy/runtime @zonease/happy@latest',
    '~/.happy/runtime/bin/happy daemon restart',
].join(' && ');

async function main() {
    const credentials = await readCredentials();
    if (!credentials) throw new Error('No credentials in ~/.happy/access.key');

    const devices = await listDevices(credentials);
    const online = devices.filter((d) => d.active);
    console.log(`${devices.length} machines, ${online.length} online`);

    // One approval seals the directory for every device, so ask about the first
    // online one we do not have a key for yet.
    let names = await readCachedDeviceNames();
    const missing = online.find((d) => !names[d.id]);
    if (missing) {
        console.log(`Requesting authorization (approve once in Happy → Devices)...`);
        await ensureDeviceKey(credentials, missing.id, (info) => {
            console.log(`  pending request ${info.id} — approve it in the app`);
        });
        names = await readCachedDeviceNames();
    }

    for (const device of online) {
        console.log(`  ${device.id.slice(0, 8)}  ${names[device.id] ?? '(name unavailable)'}`);
    }

    const flag = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
    const target = flag('--run');
    if (!target) {
        console.log('\nPass --run <name-substring> to upgrade a device.');
        return;
    }

    const match = online.find((d) => (names[d.id] ?? '').toLowerCase().includes(target.toLowerCase()));
    if (!match) throw new Error(`No online device matches "${target}"`);

    const { key, variant } = await ensureDeviceKey(credentials, match.id);
    const socket: Socket = io(configuration.serverUrl, {
        auth: { token: credentials.token, clientType: 'user-scoped' as const },
        path: '/v1/updates',
        transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });

    const command = flag('--cmd') ?? UPGRADE;
    console.log(`\nRunning on ${names[match.id]}:\n  ${command}\n`);
    const result = await deviceExec(socket, credentials, match.id, command, {
        deviceKeyBase64: encodeBase64(key),
        deviceKeyVariant: variant,
        // The device kills the child when this expires, so a slow npm install
        // needs headroom — a SIGTERM mid-install leaves bin links unwritten.
        timeout: Number(flag('--timeout') ?? 180000),
    });
    console.log(JSON.stringify(result, null, 2));
    socket.close();
}

main().then(() => process.exit(0), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
