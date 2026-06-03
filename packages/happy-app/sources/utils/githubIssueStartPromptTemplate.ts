export const defaultGitHubIssueStartPromptTemplate = [
    '请开始处理这个 GitHub Issue：',
    '',
    '- 仓库：{repo}',
    '- Issue：#{issueNumber} {issueTitle}',
    '- 链接：{issueUrl}',
    '',
    '请使用 brainstorming skill 和我一起梳理需求，然后 brainstorming 进行规划和开发。',
    '请认真阅读里面提供的原型地址和原型代码，保证前端样式一致。',
    '请勿提交任何代码，让我检查通过再说。',
].join('\n');

export interface GitHubIssueStartPromptTemplateValues {
    repo: string;
    issueNumber: string | number;
    issueTitle: string;
    issueUrl: string;
}

const TOKEN_PATTERN = /\{(repo|issueNumber|issueTitle|issueUrl)\}/g;

export function applyGitHubIssueStartPromptTemplate(
    template: string | null | undefined,
    values: GitHubIssueStartPromptTemplateValues,
): string {
    const effectiveTemplate = template?.trim() ? template : defaultGitHubIssueStartPromptTemplate;
    return effectiveTemplate.replace(TOKEN_PATTERN, (_match, key: keyof GitHubIssueStartPromptTemplateValues) => String(values[key]));
}
