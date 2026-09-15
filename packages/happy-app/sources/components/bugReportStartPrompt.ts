import type { LocalImage } from '@/components/ImagePreview';
import { stripBugImageMarkers } from '@/sync/bugRichContent';
import type { BugReportDetail } from '@/sync/bugTypes';
import { applyBugReportStartPromptTemplate, defaultBugReportStartPromptTemplate } from '@/utils/bugReportStartPromptTemplate';

export { applyBugReportStartPromptTemplate, defaultBugReportStartPromptTemplate };

export function buildBugInitialImages(bug: BugReportDetail): LocalImage[] {
    return bug.attachments.map((attachment) => ({
        uri: attachment.url,
        width: attachment.width ?? 1024,
        height: attachment.height ?? 768,
        mimeType: attachment.mimeType,
    }));
}

export function buildBugReportStartPrompt(
    bug: BugReportDetail,
    template: string = defaultBugReportStartPromptTemplate,
): string {
    const attachmentLines = bug.attachments.map((attachment, index) => (
        `- 附件 ${index + 1}：原始提交截图，${attachment.uploadedByNickname ?? '匿名用户'} 上传，URL：${attachment.url}`
    ));
    const commentLines = bug.comments.map((comment, index) => (
        `- 评论 ${index + 1}（${comment.authorNickname ?? '匿名用户'}）：${comment.body}`
    ));
    return applyBugReportStartPromptTemplate(template, {
        bugId: bug.displayId,
        bugTitle: bug.title,
        bugAuthor: bug.createdByNickname ?? '匿名用户',
        bugDescription: stripBugImageMarkers(bug.description),
        bugAttachments: attachmentLines.length > 0 ? attachmentLines.join('\n') : '- 无',
        bugComments: commentLines.length > 0 ? commentLines.join('\n') : '- 无',
    });
}
