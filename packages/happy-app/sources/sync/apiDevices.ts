import { getRandomBytes } from 'expo-crypto';
import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';
import { encryptBox, getPublicKeyForBox } from '@/encryption/libsodium';

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

/**
 * Approve a `happy ssh` authorization: seal the machine's data key to the
 * requesting CLI's throwaway public key. The server only ever relays this
 * ciphertext, so the account stays end-to-end encrypted.
 */
export async function approveDeviceKeyRequest(
    credentials: AuthCredentials,
    request: DeviceKeyRequest,
    machineDataKey: Uint8Array
): Promise<void> {
    const sealed = encryptBox(machineDataKey, decodeBase64(request.publicKey));
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
