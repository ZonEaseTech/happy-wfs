import type { PendingMessage } from '@/sync/storageTypes';
import { ImageContentSchema, type ImageContent } from '../sync/typesRaw';

type UserRawContent =
    | { role: 'user'; content?: { type: 'text'; text?: string } | { type: 'mixed'; text?: string; images?: unknown[] } };

function extractPendingText(message: PendingMessage): string {
    const content = message.content as UserRawContent | null;
    if (content?.role === 'user' && content.content && typeof content.content === 'object') {
        const body = content.content;
        if ((body.type === 'text' || body.type === 'mixed') && typeof body.text === 'string') {
            return body.text.trim();
        }
    }
    return message.previewText.trim();
}

function describePendingMessage(message: PendingMessage): string {
    const text = extractPendingText(message);
    const imageSuffix = message.imageCount > 0 ? ` [包含 ${message.imageCount} 张图片]` : '';
    if (text.length > 0) {
        return `${text}${imageSuffix}`;
    }
    return imageSuffix.trim() || '[空消息]';
}

function getOrderedPendingMessages(messages: PendingMessage[], preferredFirstId: string): PendingMessage[] {
    return [
        ...messages.filter((message) => message.id === preferredFirstId),
        ...messages.filter((message) => message.id !== preferredFirstId),
    ];
}

export function extractPendingUploadedImages(messages: PendingMessage[], preferredFirstId: string): ImageContent[] {
    const ordered = getOrderedPendingMessages(messages, preferredFirstId);
    const images: ImageContent[] = [];
    for (const message of ordered) {
        const content = message.content as UserRawContent | null;
        if (content?.role !== 'user' || !content.content || typeof content.content !== 'object') continue;
        const body = content.content;
        if (body.type !== 'mixed' || !Array.isArray(body.images)) continue;
        for (const image of body.images) {
            const parsed = ImageContentSchema.safeParse(image);
            if (parsed.success) images.push(parsed.data);
        }
    }
    return images;
}

export function buildPendingQueueBatchPrompt(messages: PendingMessage[], preferredFirstId: string): string {
    const ordered = getOrderedPendingMessages(messages, preferredFirstId);

    const items = ordered.map((message, index) => `${index + 1}. ${describePendingMessage(message)}`).join('\n\n');

    return `以下是用户排队提交的多个任务，请合并理解并按优先级一次性处理：\n\n${items}\n\n请先总结这些任务的共同目标，然后连续执行，不要逐条等待用户确认，除非遇到破坏性操作、权限问题或信息不足。`;
}
