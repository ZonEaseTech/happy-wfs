/**
 * Device key handover for `happy ssh`.
 *
 * A CLI holds only the account's content *public* key, so it can never open a
 * machine's key envelope on its own. To get an interactive shell it publishes a
 * throwaway box public key, the user approves in the app, and the app seals that
 * machine's data key to it. The opened key is cached locally so the approval is
 * a one-time step per device.
 */

import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { Credentials } from '@/persistence';
import { configuration } from '@/configuration';
import { decodeBase64, encodeBase64 } from '@/api/encryption';
import { decryptWithEphemeralKey } from '@/ui/auth';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

function deviceKeysFile(): string {
    return join(configuration.happyHomeDir, 'device-keys.json');
}

async function readDeviceKeys(): Promise<Record<string, string>> {
    const file = deviceKeysFile();
    if (!existsSync(file)) return {};
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function writeDeviceKey(machineId: string, keyBase64: string): Promise<void> {
    const file = deviceKeysFile();
    await mkdir(dirname(file), { recursive: true });
    const keys = await readDeviceKeys();
    keys[machineId] = keyBase64;
    await writeFile(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export async function readCachedDeviceKey(machineId: string): Promise<Uint8Array | null> {
    const keys = await readDeviceKeys();
    const stored = keys[machineId];
    return stored ? decodeBase64(stored) : null;
}

/**
 * Returns the machine's data key, asking the app for approval when this machine
 * has not been authorized on this computer before. `onPending` reports the
 * request so the caller can tell the user to approve it in the app.
 */
export async function ensureDeviceKey(
    credentials: Credentials,
    machineId: string,
    onPending?: (info: { id: string }) => void,
): Promise<Uint8Array> {
    const cached = await readCachedDeviceKey(machineId);
    if (cached) return cached;

    // Throwaway keypair: the seed never leaves this process, and the app seals
    // the machine key to the matching public key.
    const seed = tweetnacl.randomBytes(32);
    const secretKey = tweetnacl.hash(seed).slice(0, 32);
    const publicKey = tweetnacl.box.keyPair.fromSecretKey(secretKey).publicKey;

    const created = await axios.post<{ id: string }>(
        `${configuration.serverUrl}/v1/devices/key-requests`,
        { machineId, publicKey: encodeBase64(publicKey), label: `happy ssh from ${hostname()}` },
        { headers: { Authorization: `Bearer ${credentials.token}` }, timeout: 15000 },
    );
    onPending?.({ id: created.data.id });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await axios.get<{ approved: boolean; response: string | null; expired: boolean }>(
            `${configuration.serverUrl}/v1/devices/key-requests/${created.data.id}`,
            { headers: { Authorization: `Bearer ${credentials.token}` }, timeout: 15000 },
        );
        if (status.data.expired) {
            throw new Error('Authorization request expired. Run the command again.');
        }
        if (status.data.approved && status.data.response) {
            const opened = decryptWithEphemeralKey(decodeBase64(status.data.response), secretKey);
            if (!opened) {
                throw new Error('Could not open the device key returned by the app');
            }
            await writeDeviceKey(machineId, encodeBase64(opened));
            return opened;
        }
    }
    throw new Error('Timed out waiting for approval in the Happy app');
}
