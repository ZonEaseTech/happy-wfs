import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('files screen clean repo behavior', () => {
    it('does not list normal project files when git has no changes', () => {
        const source = read('app/(app)/session/[id]/files.tsx');

        expect(source).toContain('Only load file-list results for an explicit search');
        expect(source).not.toContain('isCleanRepo');
        expect(source).not.toContain('Show search results or all files when clean repo');
        expect(source).not.toContain('searchQuery || (gitStatusFiles.totalStaged === 0 && gitStatusFiles.totalUnstaged === 0)');
    });
});
