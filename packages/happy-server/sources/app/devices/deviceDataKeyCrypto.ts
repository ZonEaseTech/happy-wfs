import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM bundle format shared with the app and CLI ("dataKey" variant):
 * version(1) + nonce(12) + ciphertext + authTag(16). Reimplemented here so the
 * server can drive shared devices on a grantee's behalf; every other payload
 * on this server stays opaque.
 */
export function encryptWithDataKey(data: unknown, dataKey: Uint8Array): Uint8Array {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const bundle = new Uint8Array(1 + 12 + encrypted.length + 16);
    bundle.set([0], 0);
    bundle.set(nonce, 1);
    bundle.set(new Uint8Array(encrypted), 13);
    bundle.set(new Uint8Array(authTag), 13 + encrypted.length);
    return bundle;
}

export function decryptWithDataKey(bundle: Uint8Array, dataKey: Uint8Array): any | null {
    if (bundle.length < 1 + 12 + 16 || bundle[0] !== 0) {
        return null;
    }
    const nonce = bundle.slice(1, 13);
    const authTag = bundle.slice(bundle.length - 16);
    const ciphertext = bundle.slice(13, bundle.length - 16);
    try {
        const decipher = createDecipheriv('aes-256-gcm', dataKey, nonce);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
        return null;
    }
}

export function encodeBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

export function decodeBase64(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64'));
}
