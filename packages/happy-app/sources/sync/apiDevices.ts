import { getRandomBytes } from 'expo-crypto';
import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';
import { encryptBox, getPublicKeyForBox } from '@/encryption/libsodium';
import { encodeUTF8 } from '@/encryption/text';

export interface DeviceEnrollToken {
    id: string;
    lookupId: string;
    label: string | null;
    expiresAt: number;
    usedAt: number | null;
    usedByMachineId: string | null;
    createdAt: number;
}

/**
 * Mints a one-time enrollment token shaped "<lookupId>.<secret>".
 *
 * Only `lookupId` is uploaded; the account key is sealed to a keypair derived
 * from `secret`, which never leaves this device except inside the token the
 * user pastes into the target machine. The server therefore stores a blob it
 * cannot open, preserving Happy's end-to-end guarantee.
 */
export async function createDeviceEnrollToken(
    credentials: AuthCredentials,
    accountSecretBase64Url: string,
    options: { label?: string; ttlSeconds?: number } = {}
): Promise<{ token: string; expiresAt: number; id: string }> {
    const lookupId = encodeBase64(getRandomBytes(12), 'base64url');
    const secret = getRandomBytes(32);
    const sealed = encryptBox(decodeBase64(accountSecretBase64Url, 'base64url'), getPublicKeyForBox(secret));

    const response = await fetch(`${getServerUrl()}/v1/devices/enroll-tokens`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            lookupId,
            response: encodeBase64(sealed),
            ...(options.label ? { label: options.label } : {}),
            ...(options.ttlSeconds ? { ttlSeconds: options.ttlSeconds } : {})
        })
    });
    if (!response.ok) {
        throw new Error(`Failed to create enrollment token: ${response.status}`);
    }
    const data = await response.json() as { id: string; expiresAt: number };
    return {
        id: data.id,
        expiresAt: data.expiresAt,
        token: `${lookupId}.${encodeBase64(secret, 'base64url')}`
    };
}

export async function listDeviceEnrollTokens(credentials: AuthCredentials): Promise<DeviceEnrollToken[]> {
    const response = await fetch(`${getServerUrl()}/v1/devices/enroll-tokens`, {
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to list enrollment tokens: ${response.status}`);
    }
    const data = await response.json() as { tokens: DeviceEnrollToken[] };
    return data.tokens;
}

export async function revokeDeviceEnrollToken(credentials: AuthCredentials, id: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/devices/enroll-tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to revoke enrollment token: ${response.status}`);
    }
}

export function buildEnrollCommand(token: string, apiUrl: string): string {
    return `curl -fsSL ${apiUrl.replace(/\/+$/, '')}/enroll.sh | sh -s -- ${token}`;
}

export interface DeviceKeyRequest {
    id: string;
    machineId: string;
    publicKey: string;
    label: string | null;
    approved: boolean;
    expiresAt: number;
    createdAt: number;
}

export async function listDeviceKeyRequests(credentials: AuthCredentials): Promise<DeviceKeyRequest[]> {
    const response = await fetch(`${getServerUrl()}/v1/devices/key-requests`, {
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to list key requests: ${response.status}`);
    }
    const data = await response.json() as { requests: DeviceKeyRequest[] };
    return data.requests;
}

export interface DeviceDirectoryEntry {
    id: string;
    name: string;
    /** base64 machine key */
    key: string;
    /** Machines enrolled by a legacy-mode CLI use the account master secret. */
    variant: 'legacy' | 'dataKey';
}

/**
 * Approve a `happy ssh` authorization.
 *
 * Seals a directory of the account's devices — id, display name and data key —
 * to the requesting CLI's throwaway public key. Names are end-to-end encrypted
 * per machine, so a CLI that only had one machine's key could not even render a
 * readable device list; handing over the whole directory in one approval keeps
 * the prompt to a single tap and makes `happy ssh` usable.
 */
export async function approveDeviceKeyRequest(
    credentials: AuthCredentials,
    request: DeviceKeyRequest,
    directory: DeviceDirectoryEntry[]
): Promise<void> {
    const payload = encodeUTF8(JSON.stringify({ devices: directory }));
    const sealed = encryptBox(payload, decodeBase64(request.publicKey));
    const response = await fetch(`${getServerUrl()}/v1/devices/key-requests/${encodeURIComponent(request.id)}/approve`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ response: encodeBase64(sealed) })
    });
    if (!response.ok) {
        throw new Error(`Failed to approve key request: ${response.status}`);
    }
}

export async function denyDeviceKeyRequest(credentials: AuthCredentials, id: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/devices/key-requests/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to deny key request: ${response.status}`);
    }
}

/** Unenroll a device. The daemon on that machine stops being reachable; its
 *  session history is kept. */
export async function deleteDevice(credentials: AuthCredentials, machineId: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/machines/${encodeURIComponent(machineId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to delete device: ${response.status}`);
    }
}

/**
 * Correct the device flag for a machine. Enrolled devices serve shell and
 * terminals but never host sessions; machines enrolled before the CLI started
 * reporting this need it set from here.
 */
export async function setMachineDeviceFlag(
    credentials: AuthCredentials,
    machineId: string,
    isDevice: boolean
): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/machines/${encodeURIComponent(machineId)}/device-flag`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isDevice })
    });
    if (!response.ok) {
        throw new Error(`Failed to update device flag: ${response.status}`);
    }
}

/** Update the device's plaintext label so every client — and the CLI device
 *  list the AI reads — can see the rename, not just this account's own
 *  clients that can decrypt the machine metadata. */
export async function renameDevicePublicLabel(credentials: AuthCredentials, machineId: string, displayName: string | null): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/machines/${encodeURIComponent(machineId)}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ displayName })
    });
    if (!response.ok) {
        throw new Error(`Failed to rename device: ${response.status}`);
    }
}

/** Create a hosted-MCP grant covering one or more devices. The device keys
 *  travel with the request because the server drives them for the grantee —
 *  sharing deliberately relaxes end-to-end encryption for those devices. */
export async function createDeviceShare(
    credentials: AuthCredentials,
    devices: Array<{ machineId: string; deviceKey: string }>,
    options: { label?: string; expiresInDays?: number } = {}
): Promise<{ id: string; token: string }> {
    const response = await fetch(`${getServerUrl()}/v1/devices/shares`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ devices, ...options })
    });
    if (!response.ok) {
        throw new Error(`Failed to create device share: ${response.status}`);
    }
    return await response.json() as { id: string; token: string };
}

export function buildDeviceMcpConfig(serverUrl: string, token: string): string {
    return JSON.stringify({
        mcpServers: {
            'happy-devices': {
                type: 'http',
                url: `${serverUrl.replace(/\/+$/, '')}/v1/mcp/device`,
                headers: { Authorization: `Bearer ${token}` }
            }
        }
    }, null, 2);
}

export interface DeviceShare {
    id: string;
    machineIds: string[];
    label: string | null;
    expiresAt: number | null;
    lastUsedAt: number | null;
    createdAt: number;
}

export async function listDeviceShares(credentials: AuthCredentials): Promise<DeviceShare[]> {
    const response = await fetch(`${getServerUrl()}/v1/devices/shares`, {
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to list device shares: ${response.status}`);
    }
    const data = await response.json() as { shares: DeviceShare[] };
    return data.shares;
}

export async function revokeDeviceShare(credentials: AuthCredentials, id: string): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/devices/shares/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${credentials.token}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to revoke device share: ${response.status}`);
    }
}

export async function addDevicesToShare(
    credentials: AuthCredentials,
    id: string,
    devices: Array<{ machineId: string; deviceKey: string }>
): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/devices/shares/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ devices })
    });
    if (!response.ok) {
        throw new Error(`Failed to add devices: ${response.status}`);
    }
}
