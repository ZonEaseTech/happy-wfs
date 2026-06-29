import { describe, expect, it } from 'vitest';
import { MAX_SESSION_UPLOAD_FILE_BYTES, resolveSessionUploadPaths, sanitizeUploadFileName, sanitizeUploadId } from './sessionFileUpload';

describe('sessionFileUpload', () => {
    it('caps uploads at 100MB', () => {
        expect(MAX_SESSION_UPLOAD_FILE_BYTES).toBe(100 * 1024 * 1024);
    });

    it('sanitizes file names without changing the file payload format', () => {
        expect(sanitizeUploadFileName('../a/b/report.xlsx')).toBe('report.xlsx');
        expect(sanitizeUploadFileName('bad:name?.txt')).toBe('bad_name_.txt');
        expect(sanitizeUploadFileName('')).toBe('file');
    });

    it('sanitizes upload ids', () => {
        expect(sanitizeUploadId('msg_123-abc')).toBe('msg_123-abc');
        expect(sanitizeUploadId('../bad id')).toBe('badid');
    });

    it('resolves paths under the session working directory', () => {
        const paths = resolveSessionUploadPaths({
            workingDirectory: '/workspace/project',
            uploadId: '../abc',
            fileName: '../../data.csv',
        });
        expect(paths.relativePath).toBe('.happy-ai/uploads/abc/data.csv');
        expect(paths.tempRelativePath).toBe('.happy-ai/uploads/abc/data.csv.uploading');
        expect(paths.absolutePath).toBe('/workspace/project/.happy-ai/uploads/abc/data.csv');
        expect(paths.tempAbsolutePath).toBe('/workspace/project/.happy-ai/uploads/abc/data.csv.uploading');
    });
});
