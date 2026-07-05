import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, './BugReportDetailModal.tsx');
const richContentPath = resolve(__dirname, './BugRichContentView.tsx');
const richContentWebPath = resolve(__dirname, './BugRichContentView.web.tsx');
const sessionsListPath = resolve(__dirname, './SessionsList.tsx');
const shareBoardPath = resolve(__dirname, '../app/(app)/bug/index.tsx');
const previewModalPath = resolve(__dirname, './BugImagePreviewModal.tsx');
const webEditorPath = resolve(__dirname, './BugTiptapEditor.web.tsx');

describe('bug report detail modal style', () => {
    it('uses the same modal sizing rule as GitHub issue details', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain('const horizontalMargin = compact ? 12 : Math.max(24, windowSize.width * 0.02)');
        expect(source).toContain('const verticalMargin = compact ? 10 : Math.max(24, windowSize.height * 0.04)');
        expect(source).toContain('Math.min(860, windowSize.width - horizontalMargin * 2)');
        expect(source).toContain('windowSize.height - safeArea.top - safeArea.bottom - verticalMargin * 2');
        expect(source).not.toContain("maxHeight: '90%'");
    });

    it('renders the bug description in the same notes-style rich content surface as create bug', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const richContentSource = readFileSync(richContentPath, 'utf8');
        const richContentWebSource = readFileSync(richContentWebPath, 'utf8');

        expect(source).toContain('styles.notePaper');
        expect(source).toContain('noteStyle');
        expect(source).toContain('backgroundColor: theme.colors.surface');
        expect(source).toContain('borderColor: theme.colors.divider');
        expect(richContentSource).toContain('textBlockNote');
        expect(richContentSource).toContain('fontSize: 18');
        expect(richContentSource).toContain('lineHeight: 29');
        expect(richContentWebSource).toContain('EditorContent');
        expect(richContentWebSource).toContain('editable: false');
    });

    it('uses dirty-state save controls instead of an edit toggle in rich content editors', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const shareBoardSource = readFileSync(shareBoardPath, 'utf8');

        expect(source).toContain("t('common.save')");
        expect(source).toContain("t('bug.savingContent')");
        expect(source).toContain('variant="detail"');
        expect(source).toContain('contentDirty && styles.headerSaveButtonActive');
        expect(source).toContain('disabled={!canSaveContent}');
        expect(source).not.toContain("t('bug.editContent')");
        expect(source).not.toContain('styles.contentEditToolbar');

        expect(shareBoardSource).toContain("t(\"common.save\")");
        expect(shareBoardSource).toContain('contentDirty && styles.detailHeaderButtonPrimary');
        expect(shareBoardSource).toContain('disabled={!canSaveContent}');
        expect(shareBoardSource).toContain('variant=\"detail\"');
        expect(shareBoardSource).not.toContain("t(\"bug.editContent\")");
    });


    it('wires bug description and comment screenshots into a unified image preview', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const richContentSource = readFileSync(richContentPath, 'utf8');
        const richContentWebSource = readFileSync(richContentWebPath, 'utf8');
        const shareBoardSource = readFileSync(shareBoardPath, 'utf8');
        const editorWebSource = readFileSync(resolve(__dirname, './BugTiptapEditor.web.tsx'), 'utf8');
        const editorTypesSource = readFileSync(resolve(__dirname, './BugTiptapEditor.types.ts'), 'utf8');

        expect(source).toContain('BugImagePreviewModal');
        expect(source).toContain('buildBugPreviewImages(currentBug)');
        expect(source).toContain('onImagePress={openBugImagePreview}');
        expect(source).toContain('handleCommentImagePress');
        expect(richContentSource).toContain('onImagePress?: (attachment: BugAttachment) => void');
        expect(richContentWebSource).toContain('onClick={handleImageClick}');
        expect(shareBoardSource).toContain('BugImagePreviewModal');
        expect(shareBoardSource).toContain('buildBugPreviewImages(bug)');
        expect(shareBoardSource).toContain('onImageDoubleClick={openBugEditorImagePreview}');
        expect(shareBoardSource).toContain('contentSnapshot?.images.map');
        expect(editorTypesSource).toContain('onImageDoubleClick?: (src: string) => void');
        expect(editorWebSource).toContain('handleDOMEvents');
        expect(editorWebSource).toContain('dblclick: (_view, event)');
        expect(editorWebSource).toContain('onImageDoubleClickRef.current?.(image.src)');
    });

    it('keeps editor images at natural width while constraining them to the content width', () => {
        const editorWebSource = readFileSync(resolve(__dirname, './BugTiptapEditor.web.tsx'), 'utf8');
        const imageStyleBlock = editorWebSource.match(/\.happy-bug-tiptap-editor \.tiptap img \{[\s\S]*?\n\}/)?.[0];

        expect(imageStyleBlock).toContain('max-width: 100%;');
        expect(imageStyleBlock).toContain('width: auto;');
        expect(imageStyleBlock).not.toMatch(/\n\s*width:\s*100%;/);
    });

    it('makes bug editor images draggable with a white editor surface', () => {
        const editorWebSource = readFileSync(webEditorPath, 'utf8');

        expect(editorWebSource).toContain("HTMLAttributes: { draggable: 'true'");
        expect(editorWebSource).toContain('background: #FFFFFF;');
        expect(editorWebSource).toContain('cursor: grab;');
        expect(editorWebSource).toContain('cursor: grabbing;');
    });

    it('supports lightweight zoom controls in bug image preview', () => {
        const previewSource = readFileSync(previewModalPath, 'utf8');

        expect(previewSource).toContain('PanResponder.create');
        expect(previewSource).toContain('getToggledBugPreviewZoom');
        expect(previewSource).toContain('getNextBugPreviewZoom');
        expect(previewSource).toContain('resetBugPreviewZoomState()');
        expect(previewSource).toContain('shouldEnableBugPreviewZoom(Platform.OS)');
        expect(previewSource).toContain('handleWheelEvent');
        expect(previewSource).toContain("document.addEventListener('wheel'");
        expect(previewSource).toContain("document.removeEventListener('wheel'");
        expect(previewSource).toContain('event.preventDefault()');
        expect(previewSource).toContain('if (!zoomEnabled) return');
        expect(previewSource).toContain('scaleDisplay');
        expect(previewSource).not.toContain("name=\"add\"");
        expect(previewSource).not.toContain("name=\"remove\"");
        expect(previewSource).not.toContain('zoomControls');
    });

    it('renders preview screenshots with an explicit browser image on web', () => {
        const previewSource = readFileSync(previewModalPath, 'utf8');

        expect(previewSource).toContain("Platform.OS === 'web'");
        expect(previewSource).toContain('<img');
        expect(previewSource).toContain('src={currentImage.uri}');
        expect(previewSource).toContain('objectFit: \'contain\'');
        expect(previewSource).toContain('width: stageWidth');
        expect(previewSource).toContain('height: stageHeight');
    });


    it('removes the extra description header row and edit-toggle workflow from the detail modal', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).not.toContain('styles.fieldHeader');
        expect(source).not.toContain('styles.fieldHeaderActions');
        expect(source).not.toContain('styles.editTextButton');
        expect(source).not.toContain("t('bug.description')");
        expect(source).not.toContain("t('bug.editContent')");
        expect(source).not.toContain('contentEditing');
        expect(source).toContain('contentDirty && styles.headerSaveButtonActive');
        expect(source).toContain('disabled={!canSaveContent}');
    });

    it('keeps the modal header separator while removing editor frame and body scrollbar chrome', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const webEditorSource = readFileSync(webEditorPath, 'utf8');
        const headerBlock = source.match(/header: \{[\s\S]*?\n    \},/)?.[0] ?? '';

        expect(source).toContain('showsVerticalScrollIndicator={false}');
        expect(headerBlock).toContain('borderBottomWidth: 1');
        expect(webEditorSource).toContain('.happy-bug-tiptap-editor .ProseMirror-focused');
        expect(webEditorSource).toContain('border: 0 !important;');
        expect(webEditorSource).toContain('box-shadow: none !important;');
    });

    it('removes inner padding from the detail modal description while keeping comment cards padded', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const webEditorSource = readFileSync(webEditorPath, 'utf8');
        const notePaperBlock = source.match(/notePaper: \{[\s\S]*?\n    \}/)?.[0] ?? '';

        expect(notePaperBlock).toContain('borderWidth: 0');
        expect(notePaperBlock).toContain('borderRadius: 0');
        expect(notePaperBlock).not.toContain('paddingHorizontal');
        expect(notePaperBlock).not.toContain('paddingVertical');
        expect(source).toContain('contentInset="none"');
        expect(webEditorSource).toContain('no-inset');
        expect(webEditorSource).toContain('padding: 0');
        expect(webEditorSource).toContain('padding: 30px');
        expect(source).toContain('comment: { backgroundColor: theme.colors.surfaceHigh, borderRadius: 12, padding: 12');
    });

    it('keeps the bug detail modal visual style aligned with GitHub issue details', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain('backgroundColor: theme.colors.surface');
        expect(source).toContain('borderBottomColor: theme.colors.divider');
        expect(source).toContain('borderTopColor: theme.colors.divider');
        expect(source).toContain('borderColor: theme.colors.divider');
        expect(source).not.toContain("'#FDFBF7'");
        expect(source).not.toContain("'#F8F5EE'");
        expect(source).not.toContain("'#FFFEFB'");
        expect(source).not.toContain("'#E8E1D4'");
        expect(source).not.toContain("'#E6E1D8'");
    });

    it('opens bug details immediately from list summaries and loads full detail inside the modal', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const sessionsListSource = readFileSync(sessionsListPath, 'utf8');
        const shareBoardSource = readFileSync(shareBoardPath, 'utf8');

        expect(source).toContain('bug: BugReportSummary | BugReportDetail');
        expect(source).toContain('loadBug?: (bugId: string) => Promise<BugReportDetail>');
        expect(source).toContain('bugSummaryToDetail(bug)');
        expect(source).toContain('setDetailLoading(true)');

        expect(sessionsListSource).toContain('bug,');
        expect(sessionsListSource).toContain('loadBug: async (bugId: string)');
        expect(sessionsListSource).not.toContain("const detail = 'comments' in bug ? bug : await getBug(auth.credentials, bug.id)");

        expect(shareBoardSource).toContain('bug,');
        expect(shareBoardSource).toContain('loadBug: async (bugId: string) => await board.getBug(bugId)');
        expect(shareBoardSource).not.toContain("const detail = 'comments' in bug ? bug : await board.getBug(bug.id)");
    });

    it('shows only the latest status history entry in the detail modal', () => {
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain('const latestStatusEntry = currentBug.statusHistory.at(-1)');
        expect(source).toContain('latestStatusEntry ?');
        expect(source).not.toContain('currentBug.statusHistory.map(entry =>');
    });
});
