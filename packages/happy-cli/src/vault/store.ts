import axios from 'axios'
import { VaultDeviceCopySchema, vaultKvKey, type VaultDeviceCopy, type VaultUsageLog } from 'happy-wire'
import { configuration } from '@/configuration'
import type { Credentials } from '@/persistence'
import { decodeBase64, decrypt, encodeBase64, getRandomBytes, libsodiumEncryptForPublicKey, libsodiumPublicKeyFromSecretKey } from '@/api/encryption'
import { deriveKey } from '@/utils/deriveKey'
import { logger } from '@/ui/logger'

type KvItem = { key: string; value: string; version: number }

const authHeaders = (credentials: Credentials) => ({ Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' })

/**
 * The keys the app has shared with this device. Each copy is encrypted with
 * this machine's data key; a copy that does not decrypt, does not parse, or
 * names another machine or id than its KV key is skipped (any device token can
 * write the whole KV, so a copy moved between keys must not be trusted).
 */
export async function fetchDeviceKeys(credentials: Credentials, machineId: string): Promise<VaultDeviceCopy[]> {
    const prefix = vaultKvKey.devicePrefix(machineId)
    const response = await axios.get<{ items: KvItem[] }>(`${configuration.serverUrl}/v1/kv`, {
        headers: authHeaders(credentials),
        params: { prefix, limit: 1000 },
        timeout: 15000,
    })
    const [key, variant] = credentials.encryption.type === 'dataKey'
        ? [credentials.encryption.machineKey, 'dataKey' as const]
        : [credentials.encryption.secret, 'legacy' as const]

    return response.data.items.flatMap((item) => {
        const parsed = VaultDeviceCopySchema.safeParse(decrypt(key, variant, decodeBase64(item.value)))
        const intact = parsed.success && parsed.data.machineId === machineId && item.key === vaultKvKey.device(machineId, parsed.data.id)
        if (!intact) logger.debug(`[vault] skipping unreadable or mismatched copy ${item.key}`)
        return intact ? [parsed.data] : []
    })
}

/** The account content public key, which only the app can open boxes for. */
async function accountPublicKey(credentials: Credentials): Promise<Uint8Array> {
    return credentials.encryption.type === 'dataKey'
        ? credentials.encryption.publicKey
        : libsodiumPublicKeyFromSecretKey(await deriveKey(credentials.encryption.secret, 'Happy EnCoder', ['content']))
}

/**
 * Appends one usage entry. Sealed to the account key so other devices cannot
 * read it; one KV key per entry, so there is nothing to merge. Never throws:
 * a log that fails to write must not change the command's outcome.
 */
export async function writeUsageLog(credentials: Credentials, entry: VaultUsageLog): Promise<void> {
    try {
        const box = libsodiumEncryptForPublicKey(new TextEncoder().encode(JSON.stringify(entry)), await accountPublicKey(credentials))
        const value = encodeBase64(new Uint8Array([0, ...box]))
        const key = vaultKvKey.log(entry.at, encodeBase64(getRandomBytes(6), 'base64url'))
        await axios.post(`${configuration.serverUrl}/v1/kv`, { mutations: [{ key, value, version: -1 }] }, {
            headers: authHeaders(credentials),
            timeout: 10000,
        })
    } catch (error) {
        logger.debug('[vault] failed to write usage log', error)
    }
}
