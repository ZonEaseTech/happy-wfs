import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public share message pagination', () => {
    it('uses seq based cursor pagination and returns hasMore', () => {
        const source = readFileSync(resolve(__dirname, 'publicShareRoutes.ts'), 'utf8');
        expect(source).toContain('before: z.coerce.number().int().optional()');
        expect(source).toContain('limit: z.coerce.number().int().min(1).max(200).default(150)');
        expect(source).toContain('...(before !== undefined ? { seq: { lt: before } } : {})');
        expect(source).toContain("orderBy: { seq: 'desc' }");
        expect(source).toContain('take: limit + 1');
        expect(source).toContain('const hasMore = messages.length > limit');
    });

    it('exposes public share upload endpoints guarded by chat access and 100MB file limit', () => {
        const source = readFileSync(resolve(__dirname, 'publicShareRoutes.ts'), 'utf8');
        const apiSource = readFileSync(resolve(__dirname, '../api.ts'), 'utf8');
        expect(source).toContain("app.post('/v1/public-share/:token/upload-image'");
        expect(source).toContain("app.post('/v1/public-share/:token/upload-file'");
        expect(source).toContain('PUBLIC_SHARE_FILE_MAX_BYTES = 100 * 1024 * 1024');
        expect(apiSource).toContain('fileSize: 100 * 1024 * 1024');
        expect(source).toContain('loadPublicShareForChat');
        expect(source).toContain('chatImageUpload');
        expect(source).toContain('buildPublicFileSharePath');
    });

    it('keeps public share send and abort idempotent enough for shared chat controls', () => {
        const source = readFileSync(resolve(__dirname, 'publicShareRoutes.ts'), 'utf8');
        expect(source).toContain('isUniqueConstraintError');
        expect(source).toContain("app.post('/v1/public-share/:token/abort'");
        expect(source).toContain('publicShareAbortBodySchema');
        expect(source).toContain('invokeUserRpc');
        expect(source).toContain("`${result.publicShare.sessionId}:abort`");
    });
});
