import { describe, expect, it } from 'vitest';
import { buildGitHubIssueStartPrompt } from './githubIssueStartPrompt';

const issue = {
    repository: 'ZonEaseTech/ttpos-flutter',
    number: 306,
    title: '支付手续费管理 — 配置 + 订单冻结 + 报表扣费口径',
    htmlUrl: 'https://github.com/ZonEaseTech/ttpos-flutter/issues/306',
};

describe('buildGitHubIssueStartPrompt', () => {
    it('uses the dynamic GitHub issue template for new sessions', () => {
        const prompt = buildGitHubIssueStartPrompt(issue);

        expect(prompt).toBe([
            '请开始处理这个 GitHub Issue：',
            '',
            '- 仓库：ZonEaseTech/ttpos-flutter',
            '- Issue：#306 支付手续费管理 — 配置 + 订单冻结 + 报表扣费口径',
            '- 链接：https://github.com/ZonEaseTech/ttpos-flutter/issues/306',
            '',
            '请使用 brainstorming skill 和我一起梳理需求，然后 brainstorming 进行规划和开发。',
            '请认真阅读里面提供的原型地址和原型代码，保证前端样式一致。',
            '请勿提交任何代码，让我检查通过再说。',
        ].join('\n'));
        expect(prompt).not.toContain('Issue 内容');
        expect(prompt).not.toContain('执行要求');
    });

    it('replaces supported variables in a custom start prompt template', () => {
        const prompt = buildGitHubIssueStartPrompt(issue, [
            '处理：{repo}#{issueNumber}',
            '标题：{issueTitle}',
            '地址：{issueUrl}',
        ].join('\n'));

        expect(prompt).toBe([
            '处理：ZonEaseTech/ttpos-flutter#306',
            '标题：支付手续费管理 — 配置 + 订单冻结 + 报表扣费口径',
            '地址：https://github.com/ZonEaseTech/ttpos-flutter/issues/306',
        ].join('\n'));
    });

    it('falls back to the default prompt when the custom template is blank', () => {
        expect(buildGitHubIssueStartPrompt(issue, '  \n  ')).toBe(buildGitHubIssueStartPrompt(issue));
    });
});
