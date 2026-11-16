import * as React from 'react';
import { VaultKeySchema, VaultUsageLogSchema, vaultKeyDevices, vaultKvKey, type VaultDeviceCopy, type VaultKey, type VaultUsageLog } from 'happy-wire';
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
        openOldKeysOnce(keys);
    })().finally(() => { inflight = null; });
    return inflight;
}

/** Set once per account, after the keys from before keys started open have been opened. */
const OPEN_BY_DEFAULT_MARK = 'vault:meta:open-by-default-v1';
let opening: Promise<void> | null = null;

/**
 * Keys made before web 1.3.51 only ran the commands they listed, so agents kept waiting on the
 * user to allow each new one. Once per account, each such key gets `*` in front of its rules: it
 * runs anything but its deny list, like a new key, and the old rules stay behind the `*` for
 * whoever narrows the key again. The mark keeps a key the user narrows later from being reopened;
 * a key that cannot be written now (a device whose key this client lacks) is tried on a later load.
 */
function openOldKeysOnce(keys: VaultKey[]): void {
    opening ??= (async () => {
        const credentials = sync.getCredentials();
        if (!credentials || (await kvBulkGet(credentials, [OPEN_BY_DEFAULT_MARK])).values.length > 0) return;
        let opened = 0;
        let failed = 0;
        for (const key of keys.filter((candidate) => !candidate.allow.includes('*'))) {
            try {
                await writeKey({ ...key, allow: ['*', ...key.allow], updatedAt: Date.now() }, key);
                opened++;
            } catch {
                failed++;
            }
        }
        if (failed > 0) {
            opening = null;
        } else {
            await kvMutate(credentials, [{ key: OPEN_BY_DEFAULT_MARK, value: await sync.encryption.encryptRaw({ v: 1, at: Date.now() }), version: -1 }]);
        }
        if (opened > 0) await refreshVault();
    })().catch(() => { opening = null; });
}


/**
 * Writes the account record plus one copy per allowed device, and deletes the
 * copies of devices the key no longer goes to. Versions come from the server
 * and a version mismatch (someone else wrote in between) is retried.
 */
async function writeKey(next: VaultKey | null, previous: VaultKey | null): Promise<void> {
    const credentials = sync.getCredentials();
    if (!credentials) throw new Error('Not signed in');
    const id = (next ?? previous)!.id;
    const nextDevices = next ? vaultKeyDevices(next) : [];
    const goneDevices = previous ? vaultKeyDevices(previous).filter((machineId) => !nextDevices.includes(machineId)) : [];

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
