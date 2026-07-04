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

    it('uses a single centered panel instead of an empty detail pane when there are no bugs', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain('const isDesktopEmpty = filteredBugs.length === 0');
        expect(source).toContain('styles.desktopEmptyShell');
        expect(source).toContain('styles.desktopEmptyPanel');
    });

    it('keeps the desktop detail pane readable instead of squeezing it into a nested right rail', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("backgroundColor: '#F5F5F4'");
        expect(source).toContain('borderRadius: 28');
        expect(source).toContain("backgroundColor: '#FBFBFA'");
        expect(source).toContain('borderTopWidth: 1');
        expect(source).not.toContain('width: 286');
        expect(source).not.toContain('borderLeftWidth: 1');
        expect(source).toContain('historyCard');
    });

});
