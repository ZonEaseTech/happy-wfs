import { describe, expect, it } from 'vitest';
import type { BugReportDetail } from '@/sync/bugTypes';
import { buildBugInitialImages, buildBugReportStartPrompt } from './bugReportStartPrompt';

const bug: BugReportDetail = {
    id: 'bug-1',
    displayNumber: 1042,
    displayId: 'BUG-1042',
    title: '提交订单后页面一直转圈',
    description: '提交订单后页面一直转圈，无法完成支付。',
    contentJson: null,
    status: 'verify',
    visibility: 'shared',
    createdByNickname: '测试李',
    attachmentCount: 1,
    commentCount: 1,
    sessionId: null,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    attachments: [{ id: 'att-1', url: 'https://files.example/a.png', mimeType: 'image/png', sizeBytes: 100, width: 800, height: 600, thumbhash: null, uploadedByNickname: '测试李', createdAt: 1 }],
    comments: [{ id: 'c-1', body: '补充：只在生产出现。', authorNickname: '王五', createdAt: 2, attachments: [] }],
    statusHistory: [{ id: 'h-1', action: 'return_to_pending', fromStatus: 'verify', toStatus: 'pending', actorNickname: '王五', note: null, createdAt: 3 }],
};

describe('bugReportStartPrompt', () => {
    it('includes bug context but keeps status data out of the AI prompt', () => {
        const prompt = buildBugReportStartPrompt(bug);
        expect(prompt).toContain('BUG-1042');
        expect(prompt).toContain('提交订单后页面一直转圈，无法完成支付。');
        expect(prompt).toContain('附件 1');
        expect(prompt).toContain('补充：只在生产出现。');
        expect(prompt).toContain('请勿提交任何代码，让我检查通过再说');
        expect(prompt).not.toContain('当前状态');
        expect(prompt).not.toContain('待验证');
        expect(prompt).not.toContain('状态历史');
        expect(prompt).not.toContain('打回待处理');
    });


    it('removes rich content image markers from the AI prompt body', () => {
        const prompt = buildBugReportStartPrompt({
            ...bug,
            description: '第一段说明\n\n[[bug-image:1]]\n\n第二段说明',
        });
        expect(prompt).toContain('第一段说明');
        expect(prompt).toContain('第二段说明');
        expect(prompt).not.toContain('[[bug-image:1]]');
    });

    it('keeps the default output identical to the fixed prompt it replaced', () => {
        // Users who never touch the template must see no change at all.
        expect(buildBugReportStartPrompt(bug)).toBe([
            '请基于 Happy Bug BUG-1042 开始修复。',
            '',
            '标题：提交订单后页面一直转圈',
            '提交人：测试李',
            '',
            '问题说明：',
            '提交订单后页面一直转圈，无法完成支付。',
            '',
            '截图附件：',
            '- 附件 1：原始提交截图，测试李 上传，URL：https://files.example/a.png',
            '',
            '评论补充：',
            '- 评论 1（王五）：补充：只在生产出现。',
            '',
            '请先分析根因和修复方案，再做最小必要修改。请勿提交任何代码，让我检查通过再说。',
        ].join('\n'));
        expect(buildBugReportStartPrompt({ ...bug, attachments: [], comments: [] })).toContain('截图附件：\n- 无\n\n评论补充：\n- 无');
    });

    it('fills a custom template and falls back to the default when it is blank', () => {
        const prompt = buildBugReportStartPrompt(bug, '修 {bugId}（{bugAuthor} 提）：{bugTitle}\n{bugComments}');
        expect(prompt).toBe('修 BUG-1042（测试李 提）：提交订单后页面一直转圈\n- 评论 1（王五）：补充：只在生产出现。');
        expect(buildBugReportStartPrompt(bug, '   ')).toBe(buildBugReportStartPrompt(bug));
    });

    it('inserts free text literally even when it looks like a replacement pattern', () => {
        const prompt = buildBugReportStartPrompt({ ...bug, title: '金额显示 $& 和 $1' }, '{bugTitle}');
        expect(prompt).toBe('金额显示 $& 和 $1');
    });

    it('builds initial images from Bug attachments', () => {
        expect(buildBugInitialImages(bug)).toEqual([{ uri: 'https://files.example/a.png', width: 800, height: 600, mimeType: 'image/png' }]);
    });
});
