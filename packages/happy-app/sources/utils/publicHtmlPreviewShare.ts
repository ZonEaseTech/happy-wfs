const DEFAULT_APP_ORIGIN = 'https://app.happy.weifashi.cn';
const PUBLIC_FILE_SHARE_HOST = 's3.happy.weifashi.cn';
const PUBLIC_FILE_SHARE_PATH_PREFIX = '/public/file-shares/';

export function getPublicHtmlPreviewAppOrigin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }
    return DEFAULT_APP_ORIGIN;
}

export function buildPublicHtmlPreviewUrl(fileUrl: string, title?: string | null, appOrigin = getPublicHtmlPreviewAppOrigin()): string {
    const params = new URLSearchParams({ url: fileUrl });
    const cleanTitle = title?.trim();
    if (cleanTitle) {
        params.set('title', cleanTitle.slice(0, 200));
    }
    return `${appOrigin.replace(/\/+$/, '')}/share/html?${params.toString()}`;
}

export function isAllowedPublicHtmlPreviewSourceUrl(fileUrl: string): boolean {
    try {
        const parsed = new URL(fileUrl);
        return parsed.protocol === 'https:'
            && parsed.hostname === PUBLIC_FILE_SHARE_HOST
            && parsed.pathname.startsWith(PUBLIC_FILE_SHARE_PATH_PREFIX)
            && /\.html?$/i.test(parsed.pathname);
    } catch {
        return false;
    }
}
