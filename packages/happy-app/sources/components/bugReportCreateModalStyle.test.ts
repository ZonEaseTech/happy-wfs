import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, './BugReportCreateModal.tsx');
const webEditorPath = resolve(__dirname, './BugTiptapEditor.web.tsx');

describe('bug report create modal style', () => {
    it('uses the V5 Mac Notes inspired editor surface tokens', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("backgroundColor: '#FDFBF7'");
        expect(source).toContain("backgroundColor: '#FFFEFB'");
        expect(source).toContain("borderColor: '#E6E1D8'");
        expect(source).toContain('emptyNoteTextInput');
    });

    it('keeps the placeholder inside the note editor without a focused textarea frame', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).not.toContain('emptyEditorHint');
        expect(source).toContain("placeholder={index === 0 && showEmptyHint ? t('bug.noteStylePlaceholder') : ''}");
        expect(source).toContain("outlineStyle: 'none'");
        expect(source).toContain("boxShadow: 'none'");
    });

    it('uses Tiptap for the web rich text bug editor', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const webEditorSource = readFileSync(webEditorPath, 'utf8');

        expect(source).toContain('BugTiptapEditor');
        expect(source).toContain("Platform.OS === 'web'");
        expect(webEditorSource).toContain('EditorContent');
        expect(webEditorSource).toContain('StarterKit');
        expect(webEditorSource).toContain('ImageExtension');
        expect(webEditorSource).toContain('Placeholder');
        expect(webEditorSource).toContain("'happy-bug-tiptap-editor'");
        expect(webEditorSource).toContain("variant === 'detail' ? 'detail' : ''");
    });

    it('does not render a separate description label row above the editor', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).not.toContain('<View style={styles.fieldHeader}>');
        expect(source).not.toContain("t('bug.description')");
        expect(source).not.toContain("t('bug.imageCounter'");
        expect(source).not.toContain('requiredMark');
    });
});
