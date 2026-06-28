import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('Preview Html sharing', () => {
    it('adds a share button that uploads the rendered html as a public html file', () => {
        const source = read('components/tools/views/PreviewHtmlViewFull.tsx');

        expect(source).toContain('handleSharePreviewHtml');
        expect(source).toContain('uploadPublicFileShare');
        expect(source).toContain('sanitizePreviewHtmlFileName');
        expect(source).toContain("mimeType: 'text/html'");
        expect(source).toContain("Ionicons name=\"share-outline\"");
        expect(source).toContain("accessibilityLabel={t('files.share')}");
        expect(source).toContain('copyTextToClipboardVerified');
    });
});
