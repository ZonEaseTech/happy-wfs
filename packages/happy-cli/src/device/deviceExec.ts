/**
 * Run a shell command on an enrolled device.
 *
 * Devices are ordinary Happy machines, so this reuses the machine RPC path the
 * mobile app already uses: resolve the target machine's per-row key from the
 * account credentials, encrypt the request to it, and let the server forward
 * `<machineId>:bash` to that machine's daemon.
 */

import axios from 'axios';
import type { Socket } from 'socket.io-client';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decodeBase64, encodeBase64, encrypt, decrypt } from '@/api/encryption';
import { decryptWithEphemeralKey } from '@/ui/auth';

export interface DeviceSummary {
    id: string;
    name: string;
    platform: string | null;
    active: boolean;
    lastActiveAt: number;
}

export interface DeviceExecResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

interface RawMachineRow {
    id: string;
    /** Plaintext label, readable without the machine key. */
    displayName?: string | null;
    metadata: string | null;
    dataEncryptionKey: string | null;
    active: boolean;
    activeAt?: number;
    lastActiveAt?: number;
}

function resolveMachineKey(
    credentials: Credentials,
    dataEncryptionKey: string | null,
): { key: Uint8Array; variant: 'legacy' | 'dataKey' } | null {
    if (credentials.encryption.type === 'legacy') {
        return { key: credentials.encryption.secret, variant: 'legacy' };
    }
    if (!dataEncryptionKey) return null;
    const blob = decodeBase64(dataEncryptionKey);
    if (blob.length < 1 || blob[0] !== 0) return null;
    const opened = decryptWithEphemeralKey(blob.slice(1), credentials.encryption.machineKey);
    return opened ? { key: opened, variant: 'dataKey' } : null;
}

async function fetchMachines(credentials: Credentials): Promise<RawMachineRow[]> {
    const response = await axios.get<{ machines: RawMachineRow[] } | RawMachineRow[]>(
        `${configuration.serverUrl}/v1/machines`,
        { headers: { Authorization: `Bearer ${credentials.token}` }, timeout: 15000 },
    );
    const data = response.data as any;
    return Array.isArray(data) ? data : (data.machines ?? []);
}

export async function listDevices(credentials: Credentials): Promise<DeviceSummary[]> {
    const rows = await fetchMachines(credentials);
    return rows.map((row) => {
        const resolved = resolveMachineKey(credentials, row.dataEncryptionKey);
        let metadata: any = null;
        if (resolved && row.metadata) {
            try {
                metadata = decrypt(resolved.key, resolved.variant, decodeBase64(row.metadata));
            } catch {
                metadata = null;
            }
        }
        return {
            id: row.id,
            name: row.displayName || metadata?.displayName || metadata?.host || row.id.slice(0, 12),
            platform: metadata?.platform ?? null,
            active: row.active,
            lastActiveAt: row.activeAt ?? row.lastActiveAt ?? 0,
        };
    });
}

/**
 * `deviceKeyBase64` comes from the session metadata the app wrote when the user
 * picked a target device: a CLI process only holds the account's content public
 * key, so it can never open a machine's key envelope on its own.
 */
export async function deviceExec(
    socket: Socket<any, any>,
    credentials: Credentials,
    deviceId: string,
    command: string,
    options: { cwd?: string; timeout?: number; deviceKeyBase64?: string | null } = {},
): Promise<DeviceExecResult> {
    const rows = await fetchMachines(credentials);
    const row = rows.find((candidate) => candidate.id === deviceId);
    if (!row) {
        throw new Error(`Device ${deviceId} not found`);
    }
    if (!row.active) {
        throw new Error(`Device ${deviceId} is offline`);
    }
    const resolved = options.deviceKeyBase64
        ? { key: decodeBase64(options.deviceKeyBase64), variant: 'dataKey' as const }
        : resolveMachineKey(credentials, row.dataEncryptionKey);
    if (!resolved) {
        throw new Error(`Cannot resolve encryption key for device ${deviceId}. Re-select the device in the app.`);
    }

    const timeout = options.timeout ?? 60000;
    const params = encodeBase64(encrypt(resolved.key, resolved.variant, {
        command,
        cwd: options.cwd,
        timeout,
    }));

    const answer: any = await socket.timeout(timeout + 5000).emitWithAck('rpc-call', {
        method: `${deviceId}:bash`,
        params,
    });
    if (!answer?.ok) {
        throw new Error(answer?.error || 'Device RPC failed');
    }
    const decrypted = decrypt(resolved.key, resolved.variant, decodeBase64(answer.result));
    if (!decrypted) {
        throw new Error('Failed to decrypt device response');
    }
    return decrypted as DeviceExecResult;
}
