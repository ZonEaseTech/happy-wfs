import { describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from './base64';

vi.mock('rn-encryption', async () => await import('web-secure-encryption'));

describe('AES web encryption', () => {
    it('encrypts and decrypts xlsx-sized string payloads without overflowing the call stack', async () => {
        const { encryptAESGCMString, decryptAESGCMString } = await import('./aes');
        const key = encodeBase64(new Uint8Array(32).fill(7));
        const payload = JSON.stringify({
            path: '.happy-ai/uploads/file/si-error-info-20260624180854.xlsx',
            content: 'x'.repeat(160 * 1024),
        });

        const encrypted = await encryptAESGCMString(payload, key);
        const decrypted = await decryptAESGCMString(encrypted, key);

        expect(decrypted).toBe(payload);
    });
});
