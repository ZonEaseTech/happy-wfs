import { describe, expect, it } from 'vitest';
import { buildPublicHtmlPreviewUrl, isAllowedPublicHtmlPreviewSourceUrl } from './publicHtmlPreviewShare';

describe('public HTML preview sharing', () => {
    it('wraps the public S3 html file in a Happy preview page URL', () => {
        const url = buildPublicHtmlPreviewUrl(
            'https://s3.happy.weifashi.cn/public/file-shares/acct/file_abc.html',
            'Issue #510 · PO 产品确认',
            'https://app.happy.weifashi.cn',
        );

        expect(url).toBe(
            'https://app.happy.weifashi.cn/share/html?url=https%3A%2F%2Fs3.happy.weifashi.cn%2Fpublic%2Ffile-shares%2Facct%2Ffile_abc.html&title=Issue+%23510+%C2%B7+PO+%E4%BA%A7%E5%93%81%E7%A1%AE%E8%AE%A4',
        );
    });

    it('only allows public html file-share source URLs', () => {
        expect(isAllowedPublicHtmlPreviewSourceUrl('https://s3.happy.weifashi.cn/public/file-shares/acct/file_abc.html')).toBe(true);
        expect(isAllowedPublicHtmlPreviewSourceUrl('https://s3.happy.weifashi.cn/public/file-shares/acct/file_abc.xlsx')).toBe(false);
        expect(isAllowedPublicHtmlPreviewSourceUrl('https://example.com/public/file-shares/acct/file_abc.html')).toBe(false);
    });
});
