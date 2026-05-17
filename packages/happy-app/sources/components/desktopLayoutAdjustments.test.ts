import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('desktop layout adjustments', () => {
    it('renders the public share owner metadata in the same header row as the title', () => {
        const source = read('app/(app)/share/[token].tsx');
        expect(source).toContain('ShareHeader');
        expect(source).toContain('styles.shareHeader');
        expect(source).toContain('styles.shareOwnerInline');
        expect(source).toContain("flexWrap: 'nowrap'");
        expect(source).not.toContain('{owner && <OwnerCard owner={owner} />}');

        const layout = read('app/(app)/_layout.tsx');
        expect(layout).toMatch(/name="share\/\[token\]"[\s\S]*?headerShown: false/);
    });

    it('uses a contained desktop dialog for MCP server management instead of a full-page modal', () => {
        const source = read('components/McpServersModal.tsx');
        expect(source).toContain('transparent={true}');
        expect(source).toContain('styles.backdrop');
        expect(source).toContain('styles.dialog');
        expect(source).not.toContain('transparent={false}');
    });

    it('gives large web prompts more desktop width and height', () => {
        const source = read('modal/components/WebPromptModal.tsx');
        expect(source).toContain('LARGE_PROMPT_MAX_WIDTH = 720');
        expect(source).toContain('LARGE_PROMPT_HEIGHT_RATIO = 0.9');
        expect(source).toContain('visibleMultilineRows = config.multiline ? Math.min(config.multilineRows ?? 6, isLargePrompt ? 16 : 8) : 1');
    });
});
