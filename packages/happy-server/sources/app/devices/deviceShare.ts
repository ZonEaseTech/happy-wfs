import crypto from "crypto";
import { db } from "@/storage/db";
import { encryptBytes, decryptBytes } from "@/modules/encrypt";
import { getOrCreateUserRpcListeners } from "@/app/api/socket/rpcRegistry";
import { encryptWithDataKey, decryptWithDataKey, encodeBase64, decodeBase64 } from "./deviceDataKeyCrypto";

const TOKEN_BYTES = 32;
const ENCRYPT_PATH = ['device-share-key'];

export type DeviceShareGrant = {
    id: string;
    accountId: string;
    machineId: string;
    deviceKey: Uint8Array;
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
    machineId: string;
    deviceKeyBase64: string;
    label?: string | null;
    expiresAt?: Date | null;
}): Promise<{ id: string; token: string }> {
    const machine = await db.machine.findFirst({ where: { accountId, id: input.machineId } });
    if (!machine) {
        throw Object.assign(new Error('Machine not found'), { statusCode: 404 });
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const created = await db.deviceShareToken.create({
        data: {
            accountId,
            machineId: input.machineId,
            tokenHash: hashToken(token),
            label: input.label?.trim() || null,
            deviceKey: Buffer.from(encryptBytes(ENCRYPT_PATH, new Uint8Array(decodeBase64(input.deviceKeyBase64)) as Uint8Array<ArrayBuffer>)),
            expiresAt: input.expiresAt ?? null,
        },
    });
    return { id: created.id, token };
}

export async function deviceShareList(accountId: string) {
    return await db.deviceShareToken.findMany({
        where: { accountId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, machineId: true, label: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    });
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
    const deviceKey = decryptBytes(ENCRYPT_PATH, new Uint8Array(row.deviceKey) as Uint8Array<ArrayBuffer>);
    if (!deviceKey) return null;
    void db.deviceShareToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => { });
    return { id: row.id, accountId: row.accountId, machineId: row.machineId, deviceKey };
}

/**
 * Run a command on the granted device. Mirrors what a CLI client would do:
 * encrypt the payload with the device key and relay it over the machine's
 * registered RPC socket.
 */
export async function deviceShareExec(grant: DeviceShareGrant, input: {
    command: string;
    cwd?: string;
    timeout?: number;
}): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
    const listeners = getOrCreateUserRpcListeners(grant.accountId);
    const method = `machine:${grant.machineId}:bash`;
    const targetSocket = listeners.get(method);
    if (!targetSocket?.connected) {
        throw Object.assign(new Error('Device is offline'), { statusCode: 409 });
    }
    const timeout = Math.min(input.timeout ?? 60000, 300000);
    const params = encodeBase64(encryptWithDataKey({
        command: input.command,
        cwd: input.cwd,
        timeout,
    }, grant.deviceKey));
    const answer: any = await targetSocket.timeout(timeout + 5000).emitWithAck('rpc-request', { method, params });
    if (!answer || answer.ok !== true) {
        throw new Error(typeof answer?.error === 'string' ? answer.error : 'Device call failed');
    }
    const result = decryptWithDataKey(decodeBase64(answer.result), grant.deviceKey) as any;
    return {
        success: result?.success ?? false,
        stdout: result?.stdout ?? '',
        stderr: result?.stderr ?? '',
        exitCode: result?.exitCode ?? -1,
    };
}
