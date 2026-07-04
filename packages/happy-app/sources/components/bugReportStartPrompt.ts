import type { LocalImage } from '@/components/ImagePreview';
import { stripBugImageMarkers } from '@/sync/bugRichContent';
import type { BugReportDetail } from '@/sync/bugTypes';

export function buildBugInitialImages(bug: BugReportDetail): LocalImage[] {
    return bug.attachments.map((attachment) => ({
        uri: attachment.url,
        width: attachment.width ?? 1024,
        height: attachment.height ?? 768,
        mimeType: attachment.mimeType,
    }));
}

export function buildBugReportStartPrompt(bug: BugReportDetail): string {
    const attachmentLines = bug.attachments.map((attachment, index) => (
        `- 附件 ${index + 1}：原始提交截图，${attachment.uploadedByNickname ?? '匿名用户'} 上传，URL：${attachment.url}`
    ));
    const commentLines = bug.comments.map((comment, index) => (
        `- 评论 ${index + 1}（${comment.authorNickname ?? '匿名用户'}）：${comment.body}`
    ));
    return [
        `请基于 Happy Bug ${bug.displayId} 开始修复。`,
        '',
        `标题：${bug.title}`,
        `提交人：${bug.createdByNickname ?? '匿名用户'}`,
        '',
        '问题说明：',
        stripBugImageMarkers(bug.description),
        '',
        '截图附件：',
        attachmentLines.length > 0 ? attachmentLines.join('\n') : '- 无',
        '',
        '评论补充：',
        commentLines.length > 0 ? commentLines.join('\n') : '- 无',
        '',
        '请先分析根因和修复方案，再做最小必要修改。请勿提交任何代码，让我检查通过再说。',
    ].join('\n');
}
