import * as rnCrypto from 'rn-encryption';
import { decodeUTF8, encodeUTF8 } from './text';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';

function getWebCrypto(): Crypto | null {
    const crypto = globalThis.crypto;
    if (!crypto?.subtle || !crypto.getRandomValues) {
        return null;
    }
    return crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

async function importAESKey(key64: string, usages: KeyUsage[]): Promise<CryptoKey> {
    const crypto = getWebCrypto();
    if (!crypto) {
        throw new Error('WebCrypto is not available');
    }
    return await crypto.subtle.importKey('raw', toArrayBuffer(decodeBase64(key64)), { name: 'AES-GCM' }, false, usages);
}

async function encryptAESGCMStringWeb(data: string, key64: string): Promise<string> {
    const crypto = getWebCrypto();
    if (!crypto) {
        throw new Error('WebCrypto is not available');
    }
    const key = await importAESKey(key64, ['encrypt']);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv,
            },
            key,
            encodeUTF8(data),
        ),
    );
    const combined = new Uint8Array(iv.length + encrypted.length);
    combined.set(iv, 0);
    combined.set(encrypted, iv.length);
    return encodeBase64(combined);
}

async function decryptAESGCMStringWeb(data: string, key64: string): Promise<string> {
    const crypto = getWebCrypto();
    if (!crypto) {
        throw new Error('WebCrypto is not available');
    }
    const key = await importAESKey(key64, ['decrypt']);
    const combined = decodeBase64(data);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = new Uint8Array(
        await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv,
            },
            key,
            encrypted,
        ),
    );
    return decodeUTF8(decrypted);
}

export async function encryptAESGCMString(data: string, key64: string): Promise<string> {
    if (getWebCrypto()) {
        return await encryptAESGCMStringWeb(data, key64);
    }
    return await rnCrypto.encryptAsyncAES(data, key64);
}

export async function decryptAESGCMString(data: string, key64: string): Promise<string | null> {
    if (getWebCrypto()) {
        return await decryptAESGCMStringWeb(data, key64);
    }
    const res = (await rnCrypto.decryptAsyncAES(data, key64)).trim();
    return res;
}

export async function encryptAESGCM(data: Uint8Array, key64: string): Promise<Uint8Array> {
    const encrypted = (await encryptAESGCMString(decodeUTF8(data), key64)).trim();
    return decodeBase64(encrypted);
}
export async function decryptAESGCM(data: Uint8Array, key64: string): Promise<Uint8Array | null> {
    let raw = await decryptAESGCMString(encodeBase64(data), key64);
    return raw ? encodeUTF8(raw) : null;
}
