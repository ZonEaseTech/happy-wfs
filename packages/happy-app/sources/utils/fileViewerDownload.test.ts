import { describe, expect, it } from 'vitest';
import { base64ToUint8Array, getDownloadFileName, getDownloadMimeType, sanitizeDownloadFileName } from './fileViewerDownload';

describe('fileViewerDownload utils', () => {
    it('extracts safe download names from absolute and file urls', () => {
        expect(getDownloadFileName('/tmp/ttpos-pos-order-record.mp4')).toBe('ttpos-pos-order-record.mp4');
        expect(getDownloadFileName('file:///tmp/report.xlsx')).toBe('report.xlsx');
        expect(getDownloadFileName('/tmp/')).toBe('tmp');
        expect(getDownloadFileName('')).toBe('download');
    });

    it('sanitizes names for cache files and browser download names', () => {
        expect(sanitizeDownloadFileName('a/b:c*?.xlsx')).toBe('a_b_c__.xlsx');
        expect(sanitizeDownloadFileName('  report   final.xlsx  ')).toBe('report final.xlsx');
        expect(sanitizeDownloadFileName('\u0000')).toBe('download');
    });

    it('returns useful MIME types for binary office and video files', () => {
        expect(getDownloadMimeType('/tmp/a.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(getDownloadMimeType('/tmp/a.xls')).toBe('application/vnd.ms-excel');
        expect(getDownloadMimeType('/tmp/a.mp4')).toBe('video/mp4');
        expect(getDownloadMimeType('/tmp/a.webm')).toBe('video/webm');
        expect(getDownloadMimeType('/tmp/a.unknown')).toBe('application/octet-stream');
    });

    it('decodes base64 into bytes for web blob downloads', () => {
        expect(Array.from(base64ToUint8Array('AQID/w=='))).toEqual([1, 2, 3, 255]);
    });
});
