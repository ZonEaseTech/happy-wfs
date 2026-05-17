import { describe, expect, it } from 'vitest';
import type { PendingMessage } from '@/sync/storageTypes';
import { buildPendingQueueBatchPrompt } from './pendingQueueBatchPrompt';

function pending(partial: Partial<PendingMessage>): PendingMessage {
    return {
        id: partial.id ?? 'p',
        localId: partial.localId ?? 'l',
        content: partial.content ?? null,
        previewText: partial.previewText ?? '',
        imageCount: partial.imageCount ?? 0,
        sentBy: partial.sentBy ?? null,
        sentByName: partial.sentByName ?? null,
        trackCliDelivery: partial.trackCliDelivery ?? true,
        pinnedAt: partial.pinnedAt ?? null,
        createdAt: partial.createdAt ?? 0,
        updatedAt: partial.updatedAt ?? 0,
    };
}

describe('buildPendingQueueBatchPrompt', () => {
    it('puts clicked pending message first and includes all queued tasks', () => {
        const text = buildPendingQueueBatchPrompt([
            pending({ id: 'a', content: { role: 'user', content: { type: 'text', text: '先查接口' } }, previewText: '先查接口' }),
            pending({ id: 'b', content: { role: 'user', content: { type: 'text', text: '再修 UI' } }, previewText: '再修 UI' }),
            pending({ id: 'c', previewText: '最后验证' }),
        ], 'b');

        expect(text).toContain('以下是用户排队提交的多个任务');
        expect(text).toMatch(/1\. 再修 UI[\s\S]*2\. 先查接口[\s\S]*3\. 最后验证/);
        expect(text).toContain('请先总结这些任务的共同目标');
    });

    it('marks queued image-only tasks when text is empty', () => {
        const text = buildPendingQueueBatchPrompt([
            pending({ id: 'img', content: { role: 'user', content: { type: 'mixed', text: '', images: [{ id: 'i' }] } }, previewText: '', imageCount: 1 }),
        ], 'img');

        expect(text).toContain('1. [包含 1 张图片]');
    });
});
