const PREVIEW_IMAGE_MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

const PREVIEW_VIDEO_MIME_BY_EXT: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
};


export function isAbsoluteLocalPath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

export function isOutsideWorkingDirectoryError(error?: string | null): boolean {
    return typeof error === 'string' && error.includes('outside the working directory');
}

function getFileExtension(path: string): string | null {
    const fileName = path.split('/').pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || ext === fileName.toLowerCase()) {
        return null;
    }
    return ext;
}

export function isPreviewableImage(path: string): boolean {
    const ext = getFileExtension(path);
    return !!ext && ext in PREVIEW_IMAGE_MIME_BY_EXT;
}

export function isPreviewableHtml(path: string): boolean {
    const ext = getFileExtension(path);
    return ext === 'html' || ext === 'htm';
}

export function isPreviewableVideo(path: string): boolean {
    const ext = getFileExtension(path);
    return !!ext && ext in PREVIEW_VIDEO_MIME_BY_EXT;
}

export function isTemporaryFilePath(path: string): boolean {
    const normalizedPath = path.startsWith('file://') ? path.slice('file://'.length) : path;
    return normalizedPath.startsWith('/tmp/')
        || normalizedPath.startsWith('/var/tmp/')
        || normalizedPath.startsWith('/private/tmp/');
}

export function isTemporaryPreviewableImagePath(path: string): boolean {
    const normalizedPath = path.startsWith('file://') ? path.slice('file://'.length) : path;
    return isPreviewableImage(normalizedPath) && isTemporaryFilePath(normalizedPath);
}

export function getImageMimeType(path: string): string | null {
    const ext = getFileExtension(path);
    if (!ext) return null;
    return PREVIEW_IMAGE_MIME_BY_EXT[ext] ?? null;
}

export function getVideoMimeType(path: string): string | null {
    const ext = getFileExtension(path);
    if (!ext) return null;
    return PREVIEW_VIDEO_MIME_BY_EXT[ext] ?? null;
}

export function getExtensionFromMimeType(mimeType: string): string {
    for (const [ext, mime] of Object.entries(PREVIEW_IMAGE_MIME_BY_EXT)) {
        if (mime === mimeType) return ext;
    }
    return 'png';
}

export function buildLocalDaemonFileStreamUrl(httpPort: number | undefined | null, path: string): string | null {
    if (!Number.isSafeInteger(httpPort) || !httpPort || httpPort <= 0 || httpPort > 65535) {
        return null;
    }
    if (!path.trim()) {
        return null;
    }
    return `http://127.0.0.1:${httpPort}/file-stream?path=${encodeURIComponent(path)}`;
}
