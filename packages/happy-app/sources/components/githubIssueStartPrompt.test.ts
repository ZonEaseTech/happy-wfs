import { describe, expect, it } from 'vitest';
import { buildGitHubIssueStartPrompt } from './githubIssueStartPrompt';

describe('buildGitHubIssueStartPrompt', () => {
    it('uses the dynamic GitHub issue template for new sessions', () => {
        const prompt = buildGitHubIssueStartPrompt({
            repository: 'ZonEaseTech/ttpos-flutter',
            number: 306,
            title: '支付手续费管理 — 配置 + 订单冻结 + 报表扣费口径',
            htmlUrl: 'https://github.com/ZonEaseTech/ttpos-flutter/issues/306',
        });

        expect(prompt).toBe([
            '请开始处理这个 GitHub Issue：',
            '',
            '- 仓库：ZonEaseTech/ttpos-flutter',
            '- Issue：#306 支付手续费管理 — 配置 + 订单冻结 + 报表扣费口径',
            '- 链接：https://github.com/ZonEaseTech/ttpos-flutter/issues/306',
            '',
            '请使用 brainstorming skill 和我一起梳理需求，然后 brainstorming 进行规划和开发。',
        ].join('\n'));
        expect(prompt).not.toContain('Issue 内容');
        expect(prompt).not.toContain('执行要求');
    });
});
