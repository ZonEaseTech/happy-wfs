import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, './BugReportDetailModal.tsx');
const richContentPath = resolve(__dirname, './BugRichContentView.tsx');
const richContentWebPath = resolve(__dirname, './BugRichContentView.web.tsx');
const sessionsListPath = resolve(__dirname, './SessionsList.tsx');
const shareBoardPath = resolve(__dirname, '../app/(app)/bug/index.tsx');
const previewModalPath = resolve(__dirname, './BugImagePreviewModal.tsx');

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
        expect(source).toContain("backgroundColor: '#FFFEFB'");
        expect(source).toContain("borderColor: '#E6E1D8'");
        expect(richContentSource).toContain('textBlockNote');
        expect(richContentSource).toContain('fontSize: 18');
        expect(richContentSource).toContain('lineHeight: 29');
        expect(richContentWebSource).toContain('EditorContent');
        expect(richContentWebSource).toContain('editable: false');
    });

    it('uses explicit edit controls and a fixed edit action bar for rich content editing', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const shareBoardSource = readFileSync(shareBoardPath, 'utf8');

        expect(source).toContain("t('bug.editContent')");
        expect(source).toContain('styles.contentEditToolbar');
        expect(source).toContain("t('bug.savingContent')");
        expect(source).toContain('variant="detail"');
        expect(source).toContain('if (contentEditing) return');

        expect(shareBoardSource).toContain("t(\"bug.editContent\")");
        expect(shareBoardSource).toContain('styles.contentEditToolbar');
        expect(shareBoardSource).toContain("t(\"bug.savingContent\")");
        expect(shareBoardSource).toContain('variant=\"detail\"');
    });


    it('wires bug description and comment screenshots into a unified image preview', () => {
        const source = readFileSync(sourcePath, 'utf8');
        const richContentSource = readFileSync(richContentPath, 'utf8');
        const richContentWebSource = readFileSync(richContentWebPath, 'utf8');
        const shareBoardSource = readFileSync(shareBoardPath, 'utf8');

        expect(source).toContain('BugImagePreviewModal');
        expect(source).toContain('buildBugPreviewImages(currentBug)');
        expect(source).toContain('onImagePress={openBugImagePreview}');
        expect(source).toContain('handleCommentImagePress');
        expect(richContentSource).toContain('onImagePress?: (attachment: BugAttachment) => void');
        expect(richContentWebSource).toContain('onClick={handleImageClick}');
        expect(shareBoardSource).toContain('BugImagePreviewModal');
        expect(shareBoardSource).toContain('buildBugPreviewImages(bug)');
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
});
