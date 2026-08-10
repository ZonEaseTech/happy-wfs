import crypto from "crypto";
import { db } from "@/storage/db";
import { encryptBytes, decryptBytes } from "@/modules/encrypt";
import { getOrCreateUserRpcListeners } from "@/app/api/socket/rpcRegistry";
import { encryptWithDataKey, decryptWithDataKey, encodeBase64, decodeBase64 } from "./deviceDataKeyCrypto";

const TOKEN_BYTES = 32;
const ENCRYPT_PATH = ['device-share-key'];
const TOKEN_PATH = ['device-share-token'];

export type DeviceShareGrant = {
    id: string;
    accountId: string;
    /** machineId -> device key, for every device this token covers. */
    devices: Map<string, Uint8Array>;
};

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mint a hosted-MCP token for one device. The caller hands over the device
 * data key because the server has to encrypt RPC payloads on the grantee's
 * behalf — the grantee never holds account credentials. The key is stored
 * encrypted at rest with the server master secret.
 */
export async function deviceShareCreate(accountId: string, input: {
    devices: Array<{ machineId: string; deviceKey: string }>;
    label?: string | null;
    expiresAt?: Date | null;
}): Promise<{ id: string; token: string }> {
    if (input.devices.length === 0) {
        throw Object.assign(new Error('At least one device is required'), { statusCode: 400 });
    }
    const owned = await db.machine.findMany({
        where: { accountId, id: { in: input.devices.map((device) => device.machineId) } },
        select: { id: true },
    });
    const ownedIds = new Set(owned.map((machine) => machine.id));
    if (input.devices.some((device) => !ownedIds.has(device.machineId))) {
        throw Object.assign(new Error('Machine not found'), { statusCode: 404 });
    }
    const deviceKeys: Record<string, string> = {};
    for (const device of input.devices) {
        const sealed = encryptBytes(ENCRYPT_PATH, new Uint8Array(decodeBase64(device.deviceKey)) as Uint8Array<ArrayBuffer>);
        deviceKeys[device.machineId] = encodeBase64(sealed);
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const created = await db.deviceShareToken.create({
        data: {
            accountId,
            tokenHash: hashToken(token),
            tokenCipher: Buffer.from(encryptBytes(TOKEN_PATH, new TextEncoder().encode(token) as Uint8Array<ArrayBuffer>)),
            label: input.label?.trim() || null,
            deviceKeys,
            expiresAt: input.expiresAt ?? null,
        },
    });
    return { id: created.id, token };
}

export async function deviceShareList(accountId: string) {
    return await db.deviceShareToken.findMany({
        where: { accountId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, deviceKeys: true, label: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    });
}

/**
 * Replace the device set of an existing grant: ids in `devices` stay (their
 * stored key is reused when present), anything omitted is dropped. The token
 * itself is untouched, so the grantee keeps using the same config.
 */
export async function deviceShareSetDevices(accountId: string, id: string, devices: Array<{ machineId: string; deviceKey: string }>): Promise<boolean> {
    if (devices.length === 0) {
        throw Object.assign(new Error('At least one device is required'), { statusCode: 400 });
    }
    const row = await db.deviceShareToken.findFirst({ where: { id, accountId, revokedAt: null } });
    if (!row) return false;
    const owned = await db.machine.findMany({
        where: { accountId, id: { in: devices.map((device) => device.machineId) } },
        select: { id: true },
    });
    const ownedIds = new Set(owned.map((machine) => machine.id));
    const existing = (row.deviceKeys ?? {}) as Record<string, string>;
    const deviceKeys: Record<string, string> = {};
    for (const device of devices) {
        if (!ownedIds.has(device.machineId)) continue;
        deviceKeys[device.machineId] = existing[device.machineId]
            ?? encodeBase64(encryptBytes(ENCRYPT_PATH, new Uint8Array(decodeBase64(device.deviceKey)) as Uint8Array<ArrayBuffer>));
    }
    if (Object.keys(deviceKeys).length === 0) {
        throw Object.assign(new Error('At least one device is required'), { statusCode: 400 });
    }
    await db.deviceShareToken.update({ where: { id: row.id }, data: { deviceKeys } });
    return true;
}

export async function deviceShareRevoke(accountId: string, id: string): Promise<boolean> {
    const result = await db.deviceShareToken.updateMany({
        where: { id, accountId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    return result.count > 0;
}

/** Resolve a bearer token to its grant, or null when unknown/expired/revoked. */
export async function deviceShareResolve(token: string): Promise<DeviceShareGrant | null> {
    const row = await db.deviceShareToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    const devices = new Map<string, Uint8Array>();
    for (const [machineId, sealed] of Object.entries((row.deviceKeys ?? {}) as Record<string, string>)) {
        const key = decryptBytes(ENCRYPT_PATH, new Uint8Array(decodeBase64(sealed)) as Uint8Array<ArrayBuffer>);
        if (key) devices.set(machineId, new Uint8Array(key));
    }
    if (devices.size === 0) return null;
    void db.deviceShareToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => { });
    return { id: row.id, accountId: row.accountId, devices };
}

/**
 * Run a command on the granted device. Mirrors what a CLI client would do:
 * encrypt the payload with the device key and relay it over the machine's
 * registered RPC socket.
 */
export async function deviceShareExec(grant: DeviceShareGrant, input: {
    machineId: string;
    command: string;
    cwd?: string;
    timeout?: number;
}): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
    const deviceKey = grant.devices.get(input.machineId);
    if (!deviceKey) {
        throw Object.assign(new Error('Device is not part of this share'), { statusCode: 403 });
    }
    const listeners = getOrCreateUserRpcListeners(grant.accountId);
    // Daemons register machine-scoped handlers as `<machineId>:<method>`.
    const method = `${input.machineId}:bash`;
    const targetSocket = listeners.get(method);
    if (!targetSocket?.connected) {
        throw Object.assign(new Error('Device is offline'), { statusCode: 409 });
    }
    const timeout = Math.min(input.timeout ?? 60000, 300000);
    const params = encodeBase64(encryptWithDataKey({
        command: input.command,
        cwd: input.cwd,
        timeout,
    }, deviceKey));
    // Daemons answer `rpc-request` with the encrypted payload as a bare
    // base64 string; older/other paths may wrap it in { ok, result }.
    const answer: any = await targetSocket.timeout(timeout + 5000).emitWithAck('rpc-request', { method, params });
    const payload = typeof answer === 'string' ? answer : answer?.result;
    if (typeof payload !== 'string') {
        throw new Error(typeof answer?.error === 'string' ? answer.error : 'Device call failed');
    }
    const result = decryptWithDataKey(decodeBase64(payload), deviceKey) as any;
    if (result && typeof result === 'object' && typeof result.error === 'string') {
        throw new Error(result.error);
    }
    return {
        success: result?.success ?? false,
        stdout: result?.stdout ?? '',
        stderr: result?.stderr ?? '',
        exitCode: result?.exitCode ?? -1,
    };
}

/** Devices covered by a grant, with the plaintext label clients can render. */
export async function deviceShareDevices(grant: DeviceShareGrant): Promise<Array<{ id: string; name: string; description: string | null; active: boolean }>> {
    const rows = await db.machine.findMany({
        where: { accountId: grant.accountId, id: { in: [...grant.devices.keys()] } },
        select: { id: true, displayName: true, description: true, active: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.displayName || row.id.slice(0, 12), description: row.description, active: row.active }));
}

/** Re-read a grant's token so the owner can copy the config again. Null for
 *  grants minted before tokens were stored. */
export async function deviceShareToken(accountId: string, id: string): Promise<string | null> {
    const row = await db.deviceShareToken.findFirst({ where: { id, accountId, revokedAt: null } });
    if (!row?.tokenCipher) return null;
    const plain = decryptBytes(TOKEN_PATH, new Uint8Array(row.tokenCipher) as Uint8Array<ArrayBuffer>);
    return plain ? new TextDecoder().decode(plain) : null;
}
