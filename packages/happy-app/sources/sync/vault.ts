import * as React from 'react';
import { VaultKeySchema, VaultUsageLogSchema, vaultKvKey, type VaultDeviceCopy, type VaultKey, type VaultUsageLog } from 'happy-wire';
import { kvBulkGet, kvGetByPrefix, kvMutate, type KvMutation } from './apiKv';
import { sync } from './sync';
import { decodeUTF8 } from '@/encryption/text';

/**
 * Resource center keys (see happy-wire/src/vault.ts for the storage layout).
 *
 * The account record is encrypted with the account secret, so only this app
 * can read it; each allowed device gets its own copy encrypted with that
 * device's data key, which is what `happy run` on the device decrypts. Usage
 * entries are sealed by the CLI to the account public key.
 */

type VaultState = { loaded: boolean; keys: VaultKey[]; logs: VaultUsageLog[] };

let state: VaultState = { loaded: false, keys: [], logs: [] };
const listeners = new Set<() => void>();
const setState = (next: VaultState) => {
    state = next;
    listeners.forEach((listener) => listener());
};

export const getVaultState = () => state;

export function useVault(): VaultState {
    return React.useSyncExternalStore(
        (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        getVaultState,
        getVaultState,
    );
}

let inflight: Promise<void> | null = null;

export function refreshVault(): Promise<void> {
    const credentials = sync.getCredentials();
    if (!credentials) return Promise.resolve();
    inflight ??= (async () => {
        const [keyItems, logItems] = await Promise.all([
            kvGetByPrefix(credentials, vaultKvKey.keyPrefix, 1000),
            kvGetByPrefix(credentials, vaultKvKey.logPrefix, 300),
        ]);
        const keys = (await Promise.all(keyItems.map(async (item) => VaultKeySchema.safeParse(await sync.encryption.decryptRaw(item.value)))))
            .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
        const logs = (await Promise.all(logItems.map(async (item) => {
            const bytes = await sync.encryption.decryptEncryptionKey(item.value);
            if (!bytes) return null;
            try {
                const parsed = VaultUsageLogSchema.safeParse(JSON.parse(decodeUTF8(bytes)));
                return parsed.success ? parsed.data : null;
            } catch {
                return null;
            }
        }))).filter((entry): entry is VaultUsageLog => !!entry);
        setState({ loaded: true, keys: keys.sort((a, b) => a.name.localeCompare(b.name)), logs });
    })().finally(() => { inflight = null; });
    return inflight;
}

/** Server logins only ever live on the device that dials out. */
const devicesOf = (key: VaultKey) => (key.ssh ? [key.ssh.viaMachineId] : key.machineIds);

/**
 * Writes the account record plus one copy per allowed device, and deletes the
 * copies of devices the key no longer goes to. Versions come from the server
 * and a version mismatch (someone else wrote in between) is retried.
 */
async function writeKey(next: VaultKey | null, previous: VaultKey | null): Promise<void> {
    const credentials = sync.getCredentials();
    if (!credentials) throw new Error('Not signed in');
    const id = (next ?? previous)!.id;
    const nextDevices = next ? devicesOf(next) : [];
    const goneDevices = previous ? devicesOf(previous).filter((machineId) => !nextDevices.includes(machineId)) : [];

    const values = new Map<string, string | null>();
    values.set(vaultKvKey.key(id), next ? await sync.encryption.encryptRaw(next) : null);
    for (const machineId of nextDevices) {
        const encryption = sync.encryption.getMachineEncryption(machineId);
        if (!encryption) throw new Error(`No encryption key for device ${machineId}; open the device list once and try again.`);
        const { machineIds: _devices, ...rest } = next!;
        const copy: VaultDeviceCopy = { ...rest, machineId };
        values.set(vaultKvKey.device(machineId, id), await encryption.encryptRaw(copy));
    }
    for (const machineId of goneDevices) values.set(vaultKvKey.device(machineId, id), null);

    const existing = await kvBulkGet(credentials, [...values.keys()]);
    const versions = new Map(existing.values.map((item) => [item.key, item.version]));
    // Deleting a key that is not there is a no-op, not a mutation.
    const keys = [...values.keys()].filter((key) => values.get(key) !== null || versions.has(key));

    for (let attempt = 0; attempt < 3; attempt++) {
        const mutations: KvMutation[] = keys.map((key) => ({ key, value: values.get(key)!, version: versions.get(key) ?? -1 }));
        const result = await kvMutate(credentials, mutations);
        if (result.success) return;
        result.errors.forEach((error) => versions.set(error.key, error.version));
    }
    throw new Error('Could not save the key: it kept changing on the server. Try again.');
}

export async function saveVaultKey(next: VaultKey, previous: VaultKey | null): Promise<void> {
    await writeKey({ ...next, updatedAt: Date.now() }, previous);
    await refreshVault();
}

export async function deleteVaultKey(key: VaultKey): Promise<void> {
    await writeKey(null, key);
    await refreshVault();
}
