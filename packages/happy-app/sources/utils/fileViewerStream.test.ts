import { describe, expect, it } from 'vitest';
import { buildLocalDaemonFileStreamUrl } from './fileViewer';

describe('buildLocalDaemonFileStreamUrl', () => {
    it('builds a localhost streaming URL with an encoded absolute path', () => {
        expect(buildLocalDaemonFileStreamUrl(45678, '/tmp/bom-r6/bom-mobile-e2e.webm'))
            .toBe('http://127.0.0.1:45678/file-stream?path=%2Ftmp%2Fbom-r6%2Fbom-mobile-e2e.webm');
    });

    it('rejects invalid ports and blank paths', () => {
        expect(buildLocalDaemonFileStreamUrl(undefined, '/tmp/demo.mp4')).toBeNull();
        expect(buildLocalDaemonFileStreamUrl(0, '/tmp/demo.mp4')).toBeNull();
        expect(buildLocalDaemonFileStreamUrl(45678, '')).toBeNull();
    });
});
