import { describe, expect, it } from 'vitest';
import { buildGitHubIssueInlineMarkdownParts } from './githubIssueInlineMarkdownParts';

describe('buildGitHubIssueInlineMarkdownParts', () => {
    it('keeps ordinary text as plain string parts so browser text selection can cross it', () => {
        const parts = buildGitHubIssueInlineMarkdownParts('部署 https://example.com/demo 原型');

        expect(parts).toEqual([
            '部署 ',
            { type: 'link', text: 'https://example.com/demo', url: 'https://example.com/demo', styles: [] },
            ' 原型',
        ]);
    });

    it('only wraps styled non-link spans when markdown styling is needed', () => {
        const parts = buildGitHubIssueInlineMarkdownParts('普通 **重点** `code`');

        expect(parts).toEqual([
            '普通 ',
            { type: 'styled', text: '重点', styles: ['bold'] },
            ' ',
            { type: 'styled', text: 'code', styles: ['code'] },
        ]);
    });
});
