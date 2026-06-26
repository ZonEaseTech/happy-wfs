export const MAX_CHAT_FILE_BYTES = 100 * 1024 * 1024;

export interface LocalFileAttachment {
    id: string;
    name: string;
    size: number;
    mimeType?: string;
    blob: Blob;
}

export interface UploadedSessionFile {
    name: string;
    size: number;
    mimeType?: string;
    relativePath: string;
    absolutePath: string;
}

export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function buildUploadedFilesText(files: UploadedSessionFile[]): string {
    if (files.length === 0) return '';
    const lines = files.map((file) => `- ${file.absolutePath} (${formatFileSize(file.size)})`);
    return `\n\n我上传了以下文件，文件已放到当前 CLI 工作目录中，请直接读取这些本地路径：\n${lines.join('\n')}`;
}
