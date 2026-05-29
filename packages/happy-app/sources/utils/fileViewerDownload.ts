const DOWNLOAD_MIME_BY_EXT: Record<string, string> = {
    txt: 'text/plain;charset=utf-8',
    log: 'text/plain;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    markdown: 'text/markdown;charset=utf-8',
    json: 'application/json',
    csv: 'text/csv;charset=utf-8',
    html: 'text/html;charset=utf-8',
    htm: 'text/html;charset=utf-8',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    gz: 'application/gzip',
};

export function getDownloadFileName(filePath: string): string {
    const normalized = filePath.replace(/^file:\/\//, '');
    const name = normalized.split('/').filter(Boolean).pop()?.trim();
    return name || 'download';
}

export function sanitizeDownloadFileName(fileName: string): string {
    const sanitized = fileName
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return sanitized && !/^[._ -]+$/.test(sanitized) ? sanitized : 'download';
}

export function getDownloadMimeType(filePath: string): string {
    const fileName = getDownloadFileName(filePath).toLowerCase();
    const ext = fileName.includes('.') ? fileName.split('.').pop() : undefined;
    if (!ext) return 'application/octet-stream';
    return DOWNLOAD_MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
