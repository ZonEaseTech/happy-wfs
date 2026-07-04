import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, '../app/(app)/bug/index.tsx');

describe('bug board desktop layout', () => {
    it('keeps list and detail panes close together on wide screens', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain('maxWidth: 1160');
        expect(source).toContain('gap: 16');
    });
});
