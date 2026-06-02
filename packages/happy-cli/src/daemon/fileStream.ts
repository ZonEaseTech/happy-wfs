import path from 'node:path';

export type FileStreamRange =
  | { ok: true; partial: boolean; start: number; end: number }
  | { ok: false };

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
};

export function getFileStreamContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return VIDEO_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export function parseFileStreamRange(rangeHeader: string | undefined, size: number): FileStreamRange {
  if (!Number.isSafeInteger(size) || size <= 0) {
    return { ok: false };
  }

  if (!rangeHeader) {
    return { ok: true, partial: false, start: 0, end: size - 1 };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return { ok: false };
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return { ok: false };
  }

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false };
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return { ok: false };
  }

  return { ok: true, partial: true, start, end: Math.min(end, size - 1) };
}
