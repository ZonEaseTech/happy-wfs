export const defaultBugReportStartPromptTemplate = [
    '请基于 Happy Bug {bugId} 开始修复。',
    '',
    '标题：{bugTitle}',
    '提交人：{bugAuthor}',
    '',
    '问题说明：',
    '{bugDescription}',
    '',
    '截图附件：',
    '{bugAttachments}',
    '',
    '评论补充：',
    '{bugComments}',
    '',
    '请先分析根因和修复方案，再做最小必要修改。请勿提交任何代码，让我检查通过再说。',
].join('\n');

export interface BugReportStartPromptTemplateValues {
    bugId: string;
    bugTitle: string;
    bugAuthor: string;
    bugDescription: string;
    bugAttachments: string;
    bugComments: string;
}

const TOKEN_PATTERN = /\{(bugId|bugTitle|bugAuthor|bugDescription|bugAttachments|bugComments)\}/g;

export function applyBugReportStartPromptTemplate(
    template: string | null | undefined,
    values: BugReportStartPromptTemplateValues,
): string {
    const effectiveTemplate = template?.trim() ? template : defaultBugReportStartPromptTemplate;
    // Replacer function, not a replacement string: bug descriptions and comments
    // are free text and may contain `$&` / `$1`, which a string replacement
    // would expand instead of inserting literally.
    return effectiveTemplate.replace(TOKEN_PATTERN, (_match, key: keyof BugReportStartPromptTemplateValues) => values[key]);
}
