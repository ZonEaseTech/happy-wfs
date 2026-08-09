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
import { ensureDeviceKey } from './deviceKeys';

function matchDevice(devices: DeviceSummary[], query: string): DeviceSummary | null {
    const lowered = query.trim().toLowerCase();
    return devices.find((device) => device.id === query)
        ?? devices.find((device) => device.name.toLowerCase() === lowered)
        ?? devices.find((device) => device.name.toLowerCase().startsWith(lowered))
        ?? devices.find((device) => device.name.toLowerCase().includes(lowered))
        ?? null;
}

export async function sshDevice(credentials: Credentials, query: string): Promise<number> {
    const devices = await listDevices(credentials);
    const device = matchDevice(devices, query);
    if (!device) {
        console.error(`No enrolled device matches "${query}". Run "happy ssh" with no arguments to list devices.`);
        return 1;
    }
    if (!device.active) {
        console.error(`Device "${device.name}" is offline.`);
        return 1;
    }

    const key = await ensureDeviceKey(credentials, device.id, () => {
        console.log('Waiting for approval in the Happy app (Devices → pending request)...');
    });
    const variant = 'dataKey' as const;

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

export async function printDeviceList(credentials: Credentials): Promise<void> {
    const devices = await listDevices(credentials);
    if (devices.length === 0) {
        console.log('No devices enrolled yet. Add one from Happy → Devices.');
        return;
    }
    for (const device of devices) {
        console.log(`${device.active ? 'online ' : 'offline'}  ${device.name}${device.platform ? `  (${device.platform})` : ''}`);
    }
}
