const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

export function sanitizePublicFileName(fileName: string): string {
    const baseName = fileName.split(/[\\/]/).pop() || '';
    const cleaned = baseName
        .replace(CONTROL_CHARS, '')
        .replace(/^[.\s]+/, '')
        .trim();
    return cleaned || 'file';
}

function getSafeExtension(fileName: string): string {
    const match = sanitizePublicFileName(fileName).match(/\.([A-Za-z0-9]{1,16})$/);
    return match ? `.${match[1].toLowerCase()}` : '';
}

export function buildPublicFileSharePath(accountId: string, shareKey: string, fileName: string): string {
    return `public/file-shares/${encodeURIComponent(accountId)}/${encodeURIComponent(shareKey)}${getSafeExtension(fileName)}`;
}
