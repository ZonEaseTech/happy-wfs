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
});
