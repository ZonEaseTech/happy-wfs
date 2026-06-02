import { describe, expect, it } from 'vitest';
import { getFileStreamContentType, parseFileStreamRange } from './fileStream';

describe('daemon file stream helpers', () => {
  it('maps video extensions to browser-playable content types', () => {
    expect(getFileStreamContentType('/tmp/demo.webm')).toBe('video/webm');
    expect(getFileStreamContentType('/tmp/demo.mp4')).toBe('video/mp4');
    expect(getFileStreamContentType('/tmp/demo.mov')).toBe('video/quicktime');
    expect(getFileStreamContentType('/tmp/demo.bin')).toBe('application/octet-stream');
  });

  it('parses browser range requests for streaming playback', () => {
    expect(parseFileStreamRange(undefined, 5000)).toEqual({ ok: true, partial: false, start: 0, end: 4999 });
    expect(parseFileStreamRange('bytes=0-1023', 5000)).toEqual({ ok: true, partial: true, start: 0, end: 1023 });
    expect(parseFileStreamRange('bytes=100-', 5000)).toEqual({ ok: true, partial: true, start: 100, end: 4999 });
    expect(parseFileStreamRange('bytes=-500', 5000)).toEqual({ ok: true, partial: true, start: 4500, end: 4999 });
  });

  it('rejects invalid or unsatisfiable ranges', () => {
    expect(parseFileStreamRange('bytes=9999-10000', 5000)).toEqual({ ok: false });
    expect(parseFileStreamRange('bytes=100-50', 5000)).toEqual({ ok: false });
    expect(parseFileStreamRange('items=0-10', 5000)).toEqual({ ok: false });
    expect(parseFileStreamRange('bytes=0-10,20-30', 5000)).toEqual({ ok: false });
  });
});
