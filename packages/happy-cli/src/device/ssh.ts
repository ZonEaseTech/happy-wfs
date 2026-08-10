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
import { deviceExec, listDevices, type DeviceExecResult, type DeviceSummary } from './deviceExec';
import { execOnDeviceViaDaemon } from '@/daemon/controlClient';
import { ensureDeviceKey, pruneDeviceAliases, readCachedDeviceKey, readCachedDeviceNames } from './deviceKeys';

function matchDevice(devices: DeviceSummary[], query: string): DeviceSummary | null {
    const lowered = query.trim().toLowerCase();
    return devices.find((device) => device.id === query)
        ?? devices.find((device) => device.name.toLowerCase() === lowered)
        ?? devices.find((device) => device.name.toLowerCase().startsWith(lowered))
        ?? devices.find((device) => device.name.toLowerCase().includes(lowered))
        ?? null;
}

/** A two-repo `git pull` outruns the exec default, and the device kills the
 *  child when it expires — so command mode gets its own, larger budget. */
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

export interface SshArgs {
    target: string | null;
    /** Everything after `--`, or null for an interactive shell. */
    command: string | null;
    timeoutMs: number;
}

/**
 * `happy ssh <device> [--timeout <seconds>] [-- <command>]`.
 *
 * The command is taken verbatim from everything after `--` so quoting, pipes
 * and newlines survive; the shell already split it for us.
 */
export function parseSshArgs(args: string[]): SshArgs {
    const separator = args.indexOf('--');
    const head = separator >= 0 ? args.slice(0, separator) : args;
    const command = separator >= 0 ? args.slice(separator + 1).join(' ') : null;

    let target: string | null = null;
    let timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS;
    for (let i = 0; i < head.length; i++) {
        if (head[i] === '--timeout' || head[i] === '-t') {
            const seconds = Number(head[++i]);
            if (Number.isFinite(seconds) && seconds > 0) timeoutMs = seconds * 1000;
            continue;
        }
        if (!target && !head[i].startsWith('-')) target = head[i];
    }
    return { target, command: command && command.trim() ? command : null, timeoutMs };
}

/**
 * Run one command on a device and exit with its status.
 *
 * Uses the device's shell RPC rather than the PTY: there is no terminal to
 * allocate, output arrives as a single payload, and the remote exit code
 * becomes this process's — so it composes with scripts and CI. Progress notes
 * go to stderr to keep stdout exactly what the command printed.
 */
interface ResolvedDevice {
    device: { id: string; name: string };
    key: Uint8Array;
    variant: 'legacy' | 'dataKey';
}

/**
 * Resolve without touching the network. The approval handshake already cached
 * the name and key, and that listing request is the largest single piece of a
 * command's latency.
 *
 * Bails out when a name matches more than one id: the cache cannot tell which
 * of them still exists, and guessing wrong costs a whole extra round trip.
 */
async function resolveFromCache(query: string): Promise<ResolvedDevice | null> {
    const names = await readCachedDeviceNames();
    const id = pickCachedDeviceId(names, query);
    if (!id) return null;
    const material = await readCachedDeviceKey(id);
    return material ? { device: { id, name: names[id] }, ...material } : null;
}

/**
 * The one id this query can only mean, or null to go ask the server.
 *
 * Null on ambiguity is the whole point: re-enrolling a machine gives it a new
 * id while the old entry keeps the same name, and picking the dead one costs a
 * failed round trip plus the lookup that was being avoided — slower than never
 * having tried.
 */
export function pickCachedDeviceId(names: Record<string, string>, query: string): string | null {
    if (names[query]) return query;
    const lowered = query.trim().toLowerCase();
    for (const test of [
        (name: string) => name === lowered,
        (name: string) => name.startsWith(lowered),
        (name: string) => name.includes(lowered),
    ]) {
        const matches = Object.keys(names).filter((id) => test(names[id].toLowerCase()));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return null;
    }
    return null;
}

/** The authoritative path: reports a bad name or an offline device, and asks
 *  for approval when this machine has never been authorized for it. */
async function resolveFromServer(credentials: Credentials, query: string): Promise<ResolvedDevice | null> {
    const { devices } = await listDevicesWithNames(credentials);
    const device = matchDevice(devices, query);
    if (!device) {
        console.error(`No enrolled device matches "${query}". Run "happy ssh" with no arguments to list devices.`);
        return null;
    }
    if (!device.active) {
        console.error(`Device "${device.name}" is offline.`);
        return null;
    }
    const { key, variant } = await ensureDeviceKey(credentials, device.id, () => {
        console.error('Waiting for approval in the Happy app (Devices → pending request)...');
    });
    // Now that the server has settled which id owns this name, retire any other
    // entry claiming it, so the next run can take the fast path.
    await pruneDeviceAliases(device.id, device.name);
    return { device, key, variant };
}

export async function runOnDevice(
    credentials: Credentials,
    query: string,
    command: string,
    options: { timeoutMs?: number } = {},
): Promise<number> {
    const cached = await resolveFromCache(query);
    const resolved = cached ?? await resolveFromServer(credentials, query);
    if (!resolved) return 1;

    // A running daemon already holds a connection to the server; borrowing it
    // skips a TLS + WebSocket handshake worth roughly a third of the command.
    const viaDaemon = await execOnDeviceViaDaemon(
        resolved.device.id,
        command,
        options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    ).catch(() => null);
    if (viaDaemon) {
        return reportResult(viaDaemon as DeviceExecResult);
    }

    try {
        return await execOnResolved(credentials, resolved, command, options);
    } catch (error) {
        // The cached device may have been renamed, re-enrolled or taken
        // offline; only the server can say which, and only now is the listing
        // worth paying for.
        if (!cached) throw error;
        const fresh = await resolveFromServer(credentials, query);
        if (!fresh) return 1;
        return await execOnResolved(credentials, fresh, command, options);
    }
}

/**
 * Both paths — the daemon's connection and a socket of our own — must present a
 * command identically, or which one happened to be used would be observable.
 */
function reportResult(result: DeviceExecResult): number {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    // On an ordinary non-zero exit the device echoes node's "Command failed:
    // <whole command>" wrapper, which already contains stderr — printing it
    // repeats the error and the script back at the user. Only the cases it
    // explains on its own, such as a timeout, are worth surfacing.
    if (result.error && !result.error.startsWith('Command failed:')) {
        console.error(result.error);
    }
    return result.exitCode ?? (result.success ? 0 : 1);
}

async function execOnResolved(
    credentials: Credentials,
    { device, key, variant }: ResolvedDevice,
    command: string,
    options: { timeoutMs?: number },
): Promise<number> {
    const socket: Socket = io(configuration.serverUrl, {
        auth: { token: credentials.token, clientType: 'user-scoped' as const },
        path: '/v1/updates',
        transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });

    try {
        const result = await deviceExec(socket, credentials, device.id, command, {
            deviceKeyBase64: encodeBase64(key),
            deviceKeyVariant: variant,
            timeout: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
            // matchDevice already read the listing and rejected offline devices.
            skipMachineLookup: true,
        });
        return reportResult(result);
    } finally {
        socket.close();
    }
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
    const { devices } = await listDevicesWithNames(credentials);
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
    const chosen = await pickDevice(devices);
    if (!chosen) return 0;
    return await sshDevice(credentials, chosen.id);
}
