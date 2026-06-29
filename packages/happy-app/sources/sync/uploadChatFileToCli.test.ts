import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiSocket } from '@/sync/apiSocket';
import { uploadChatFileToCli } from './uploadChatFileToCli';

vi.mock('@/sync/apiSocket', () => ({
    apiSocket: {
        sessionRPC: vi.fn(),
    },
}));

describe('uploadChatFileToCli', () => {
    beforeEach(() => {
        vi.mocked(apiSocket.sessionRPC).mockReset();
    });

    it('falls back to legacy writeFile when chunked upload RPC is unavailable', async () => {
        const calls: Array<{ method: string; params: any }> = [];
        vi.mocked(apiSocket.sessionRPC).mockImplementation(async (_sessionId: string, method: string, params: any) => {
            calls.push({ method, params });
            if (method === 'uploadFile.init') {
                throw new Error('RPC method not available');
            }
            if (method === 'createDirectory') return { success: true };
            if (method === 'writeFile') return { success: true, bytesWritten: 2 };
            throw new Error(`unexpected method ${method}`);
        });

        const result = await uploadChatFileToCli('session-1', {
            id: '../bad id',
            name: '../tenant:rewrite.go',
            size: 2,
            blob: new Blob(['hi']),
        });

        expect(result.relativePath).toBe('.happy-ai/uploads/badid/tenant_rewrite.go');
        expect(result.absolutePath).toBe('.happy-ai/uploads/badid/tenant_rewrite.go');
        expect(calls.map(call => call.method)).toEqual([
            'uploadFile.init',
            'createDirectory',
            'createDirectory',
            'createDirectory',
            'writeFile',
        ]);
        expect(calls.at(-1)?.params).toMatchObject({
            path: '.happy-ai/uploads/badid/tenant_rewrite.go',
            content: 'aGk=',
        });
    });

    it('asks for CLI upgrade instead of legacy-uploading large files', async () => {
        vi.mocked(apiSocket.sessionRPC).mockRejectedValue(new Error('RPC method not available'));

        await expect(uploadChatFileToCli('session-1', {
            id: 'large',
            name: 'large.bin',
            size: 11 * 1024 * 1024,
            blob: new Blob(['x']),
        })).rejects.toThrow('update happy CLI');
    });
});
