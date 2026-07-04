import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, './BugReportCreateModal.tsx');

describe('bug report create modal style', () => {
    it('uses the V5 Mac Notes inspired editor surface tokens', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("backgroundColor: '#FDFBF7'");
        expect(source).toContain("backgroundColor: '#FFFEFB'");
        expect(source).toContain("borderColor: '#E6E1D8'");
        expect(source).toContain('emptyEditorHint');
    });
});
