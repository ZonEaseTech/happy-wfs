import { describe, expect, test } from 'vitest';
import { buildPublicFileSharePath, sanitizePublicFileName } from './publicFileShare';

describe('public file share helpers', () => {
    test('sanitizes file names without allowing path traversal', () => {
        expect(sanitizePublicFileName('../../secret token.xlsx')).toBe('secret token.xlsx');
        expect(sanitizePublicFileName('')).toBe('file');
        expect(sanitizePublicFileName('a/b\\c.json')).toBe('c.json');
    });

    test('builds a stable public s3 object path scoped to the account', () => {
        const path = buildPublicFileSharePath('acct_123', 'share_ABC', '订单 明细.xlsx');
        expect(path).toBe('public/file-shares/acct_123/share_ABC.xlsx');
    });
});
