import type { GitHubIssue } from '@/sync/apiGithub';
import { applyGitHubIssueStartPromptTemplate, defaultGitHubIssueStartPromptTemplate } from '@/utils/githubIssueStartPromptTemplate';

export { applyGitHubIssueStartPromptTemplate, defaultGitHubIssueStartPromptTemplate };

export function buildGitHubIssueStartPrompt(
    issue: Pick<GitHubIssue, 'repository' | 'number' | 'title' | 'htmlUrl'>,
    template: string = defaultGitHubIssueStartPromptTemplate,
): string {
    return applyGitHubIssueStartPromptTemplate(template, {
        repo: issue.repository,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.htmlUrl,
    });
}
