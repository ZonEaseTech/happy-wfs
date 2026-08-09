/**
 * `happy ssh <device>` — an interactive shell on an enrolled device.
 *
 * Reuses the PTY protocol the app's terminal already speaks: lifecycle over
 * machine RPC (pty-start / resize / close) and streaming frames over the
 * pty-input / pty-output socket events, all encrypted with the device's data
 * key. No SSH daemon or inbound port is involved — the device's outbound
 * connection carries everything.
 */

import { io, type Socket } from 'socket.io-client';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decodeBase64, encodeBase64, encrypt, decrypt } from '@/api/encryption';
import { listDevices, type DeviceSummary } from './deviceExec';
import { ensureDeviceKey, readCachedDeviceNames } from './deviceKeys';

function matchDevice(devices: DeviceSummary[], query: string): DeviceSummary | null {
    const lowered = query.trim().toLowerCase();
    return devices.find((device) => device.id === query)
        ?? devices.find((device) => device.name.toLowerCase() === lowered)
        ?? devices.find((device) => device.name.toLowerCase().startsWith(lowered))
        ?? devices.find((device) => device.name.toLowerCase().includes(lowered))
        ?? null;
}

export async function sshDevice(credentials: Credentials, query: string): Promise<number> {
    const { devices } = await listDevicesWithNames(credentials);
    const device = matchDevice(devices, query);
    if (!device) {
        console.error(`No enrolled device matches "${query}". Run "happy ssh" with no arguments to list devices.`);
        return 1;
    }
    if (!device.active) {
        console.error(`Device "${device.name}" is offline.`);
        return 1;
    }

    const { key, variant } = await ensureDeviceKey(credentials, device.id, () => {
        console.log('Waiting for approval in the Happy app (Devices → pending request)...');
    });

    const socket: Socket = io(configuration.serverUrl, {
        auth: { token: credentials.token, clientType: 'user-scoped' as const },
        path: '/v1/updates',
        transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });

    const rpc = async <R>(method: string, params: unknown): Promise<R> => {
        const answer: any = await socket.timeout(30000).emitWithAck('rpc-call', {
            method: `${device.id}:${method}`,
            params: encodeBase64(encrypt(key, variant, params)),
        });
        if (!answer?.ok) throw new Error(answer?.error || `${method} failed`);
        return decrypt(key, variant, decodeBase64(answer.result)) as R;
    };

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const started = await rpc<{ ok: boolean; ptyId?: string; error?: string }>('pty-start', { cols, rows });
    if (!started?.ok || !started.ptyId) {
        socket.close();
        console.error(`Could not open a shell on "${device.name}": ${started?.error ?? 'unknown error'}`);
        return 1;
    }
    const ptyId = started.ptyId;

    let exitCode = 0;
    const cleanup = () => {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        socket.close();
    };

    await new Promise<void>((resolve) => {
        socket.on('pty-output', (envelope: any) => {
            if (envelope?.sessionId !== device.id || envelope?.ptyId !== ptyId) return;
            try {
                const data = decrypt(key, variant, decodeBase64(envelope.data));
                if (typeof data === 'string') process.stdout.write(Buffer.from(data, 'base64'));
            } catch { /* drop undecryptable frame */ }
        });
        socket.on('pty-exit', (envelope: any) => {
            if (envelope?.sessionId !== device.id || envelope?.ptyId !== ptyId) return;
            exitCode = typeof envelope.exitCode === 'number' ? envelope.exitCode : 0;
            resolve();
        });
        socket.on('disconnect', () => resolve());

        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (chunk: Buffer) => {
            socket.volatile.emit('pty-input', {
                sessionId: device.id,
                ptyId,
                data: encodeBase64(encrypt(key, variant, chunk.toString('utf8'))),
            });
        });

        process.stdout.on('resize', () => {
            void rpc('pty-resize', {
                ptyId,
                cols: process.stdout.columns || 80,
                rows: process.stdout.rows || 24,
            }).catch(() => { });
        });
    });

    await rpc('pty-close', { ptyId }).catch(() => { });
    cleanup();
    return exitCode;
}

/**
 * Arrow-key picker for `happy ssh` with no argument. Written against raw stdin
 * rather than Ink because the very next thing this command does is hand raw
 * stdin to the remote PTY — one owner of the terminal, no teardown races.
 */
function pickDevice(devices: DeviceSummary[]): Promise<DeviceSummary | null> {
    const selectable = devices.filter((device) => device.active);
    if (selectable.length === 0) {
        console.log('No devices are online right now.');
        return Promise.resolve(null);
    }
    if (selectable.length === 1) {
        return Promise.resolve(selectable[0]);
    }

    return new Promise((resolve) => {
        let index = 0;
        let rendered = 0;

        const render = () => {
            if (rendered > 0) process.stdout.write(`\u001b[${rendered}A`);
            const lines = selectable.map((device, position) => {
                const marker = position === index ? '\u001b[36m>\u001b[0m' : ' ';
                const name = position === index ? `\u001b[1m${device.name}\u001b[0m` : device.name;
                return `\u001b[2K ${marker} ${name}${device.platform ? `  \u001b[2m${device.platform}\u001b[0m` : ''}`;
            });
            process.stdout.write(lines.join('\n') + '\n');
            rendered = lines.length;
        };

        const finish = (device: DeviceSummary | null) => {
            process.stdin.off('data', onData);
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve(device);
        };

        const onData = (chunk: Buffer) => {
            const key = chunk.toString();
            if (key === '\u001b[A' || key === 'k') {
                index = (index - 1 + selectable.length) % selectable.length;
                render();
            } else if (key === '\u001b[B' || key === 'j') {
                index = (index + 1) % selectable.length;
                render();
            } else if (key === '\r' || key === '\n') {
                finish(selectable[index]);
            } else if (key === '\u0003' || key === '\u001b' || key === 'q') {
                console.log('Cancelled.');
                finish(null);
            }
        };

        console.log('Select a device (\u2191/\u2193, Enter to connect, q to cancel):');
        render();
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
    });
}

/**
 * No device argument: pick one interactively on a TTY, otherwise just list them
 * so the command stays usable in scripts and pipes.
 */
/** Device names are encrypted per machine; the CLI can only render the ones it
 *  received in the approval handshake, so fall back to a short id otherwise. */
async function listDevicesWithNames(credentials: Credentials): Promise<{ devices: DeviceSummary[]; named: boolean }> {
    const [devices, names] = await Promise.all([listDevices(credentials), readCachedDeviceNames()]);
    let named = false;
    const withNames = devices.map((device) => {
        const cached = names[device.id];
        if (cached) named = true;
        return cached ? { ...device, name: cached } : device;
    });
    return { devices: withNames, named };
}

export async function sshPickAndConnect(credentials: Credentials): Promise<number> {
    const { devices, named } = await listDevicesWithNames(credentials);
    if (devices.length === 0) {
        console.log('No devices enrolled yet. Add one from Happy \u2192 Devices.');
        return 0;
    }
    if (!process.stdin.isTTY) {
        for (const device of devices) {
            console.log(`${device.active ? 'online ' : 'offline'}  ${device.name}${device.platform ? `  (${device.platform})` : ''}`);
        }
        console.log('\nUsage: happy ssh <device>');
        return 0;
    }
    if (!named) {
        console.log('This computer has not been authorized yet, so device names are still hidden.');
        console.log('Pick any device below and approve the request in Happy \u2192 Devices; names appear from then on.\n');
    }
    const chosen = await pickDevice(devices);
    if (!chosen) return 0;
    return await sshDevice(credentials, chosen.id);
}
