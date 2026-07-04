import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = resolve(__dirname, './BugReportDetailModal.tsx');
const richContentPath = resolve(__dirname, './BugRichContentView.tsx');
const sessionsListPath = resolve(__dirname, './SessionsList.tsx');
const shareBoardPath = resolve(__dirname, '../app/(app)/bug/index.tsx');

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

        expect(source).toContain('styles.notePaper');
        expect(source).toContain('noteStyle');
        expect(source).toContain("backgroundColor: '#FFFEFB'");
        expect(source).toContain("borderColor: '#E6E1D8'");
        expect(richContentSource).toContain('textBlockNote');
        expect(richContentSource).toContain('fontSize: 18');
        expect(richContentSource).toContain('lineHeight: 29');
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
