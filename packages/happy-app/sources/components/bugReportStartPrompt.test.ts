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

    it('builds initial images from Bug attachments', () => {
        expect(buildBugInitialImages(bug)).toEqual([{ uri: 'https://files.example/a.png', width: 800, height: 600, mimeType: 'image/png' }]);
    });
});
