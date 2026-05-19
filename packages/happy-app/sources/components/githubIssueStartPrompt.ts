import type { GitHubIssue } from '@/sync/apiGithub';

export function buildGitHubIssueStartPrompt(issue: Pick<GitHubIssue, 'repository' | 'number' | 'title' | 'htmlUrl'>): string {
    return [
        '请开始处理这个 GitHub Issue：',
        '',
        `- 仓库：${issue.repository}`,
        `- Issue：#${issue.number} ${issue.title}`,
        `- 链接：${issue.htmlUrl}`,
        '',
        '请使用 brainstorming skill 和我一起梳理需求，然后用 pma 进行规划和开发。',
    ].join('\n');
}
