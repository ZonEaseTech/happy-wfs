import { describe, expect, it } from 'vitest';
import { buildUploadedFilesText, formatFileSize, MAX_CHAT_FILE_BYTES } from '@/utils/fileAttachments';

describe('fileAttachments', () => {
    it('formats bytes, kb and mb', () => {
        expect(formatFileSize(0)).toBe('0 B');
        expect(formatFileSize(512)).toBe('512 B');
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(10 * 1024)).toBe('10 KB');
        expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('keeps uploaded files as local paths for the CLI', () => {
        expect(MAX_CHAT_FILE_BYTES).toBe(100 * 1024 * 1024);
        expect(buildUploadedFilesText([{
            name: 'a.xlsx',
            size: 1024,
            absolutePath: '/workspace/.happy-ai/uploads/u/a.xlsx',
            relativePath: '.happy-ai/uploads/u/a.xlsx',
        }])).toContain('/workspace/.happy-ai/uploads/u/a.xlsx');
    });
});
