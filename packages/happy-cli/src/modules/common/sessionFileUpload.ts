import { dirname, join, resolve, sep } from 'path';

export const MAX_SESSION_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
export const SESSION_UPLOAD_ROOT = '.happy-ai/uploads';

export function sanitizeUploadFileName(name: string): string {
    const basename = name.split(/[\\/]/).pop()?.trim() || 'file';
    const cleaned = basename
        .replace(/[\x00-\x1f:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || cleaned === '.' || cleaned === '..') return 'file';
    return cleaned.slice(0, 180);
}

export function sanitizeUploadId(id: string): string {
    const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return cleaned || 'upload';
}

function assertInside(root: string, target: string): void {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(target);
    const prefix = resolvedRoot === '/' ? '/' : resolvedRoot + sep;
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(prefix)) {
        throw new Error('Upload path escapes working directory');
    }
}

export function resolveSessionUploadPaths(params: {
    workingDirectory: string;
    uploadId: string;
    fileName: string;
}): { relativePath: string; tempRelativePath: string; absolutePath: string; tempAbsolutePath: string; directory: string } {
    const safeUploadId = sanitizeUploadId(params.uploadId);
    const safeFileName = sanitizeUploadFileName(params.fileName);
    const relativePath = join(SESSION_UPLOAD_ROOT, safeUploadId, safeFileName).replace(/\\/g, '/');
    const tempRelativePath = `${relativePath}.uploading`;
    const absolutePath = resolve(params.workingDirectory, relativePath);
    const tempAbsolutePath = resolve(params.workingDirectory, tempRelativePath);
    assertInside(params.workingDirectory, absolutePath);
    assertInside(params.workingDirectory, tempAbsolutePath);
    return {
        relativePath,
        tempRelativePath,
        absolutePath,
        tempAbsolutePath,
        directory: dirname(absolutePath),
    };
}
