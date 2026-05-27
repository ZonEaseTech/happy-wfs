import { parseMarkdownSpans } from './markdown/parseMarkdownSpans';
import type { MarkdownSpan } from './markdown/parseMarkdown';

type GitHubIssueInlineStyle = MarkdownSpan['styles'][number];

export type GitHubIssueInlineMarkdownPart = string | {
    type: 'link';
    text: string;
    url: string;
    styles: GitHubIssueInlineStyle[];
} | {
    type: 'styled';
    text: string;
    styles: GitHubIssueInlineStyle[];
};

export function buildGitHubIssueInlineMarkdownParts(text: string): GitHubIssueInlineMarkdownPart[] {
    const spans = parseMarkdownSpans(text, false);
    if (spans.length === 0) return [text];

    return spans.map((span) => {
        if (span.url) {
            return {
                type: 'link' as const,
                text: span.text,
                url: span.url,
                styles: span.styles,
            };
        }
        if (span.styles.length > 0) {
            return {
                type: 'styled' as const,
                text: span.text,
                styles: span.styles,
            };
        }
        return span.text;
    });
}
