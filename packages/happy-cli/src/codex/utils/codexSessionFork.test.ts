import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

describe('forkCodexSession', () => {
  const sessionUuid = '01a01e32-1ccd-7532-bc01-b8a0473d5b7c';
  let tempRoot: string;
  let codexHomeDir: string;
  let oldCodexHomeDir: string | undefined;
  let originalPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'codex-session-fork-'));
    codexHomeDir = join(tempRoot, 'codex-home');
    const codexSessionsDir = join(codexHomeDir, 'sessions', '2026', '08', '20');
    mkdirSync(codexSessionsDir, { recursive: true });

    oldCodexHomeDir = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHomeDir;

    originalPath = join(codexSessionsDir, `rollout-2026-08-20T08-03-15-${sessionUuid}.jsonl`);
    const lines = [
      {
        type: 'session_meta',
        payload: {
          session_id: sessionUuid,
          id: sessionUuid,
          cwd: '/workspace/happy',
          timestamp: '2026-08-20T08:03:15.000Z',
        },
        timestamp: '2026-08-20T08:03:15.000Z',
      },
      {
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ type: 'input_text', text: 'first question' }],
        },
        timestamp: '2026-08-20T08:03:16.000Z',
      },
      {
        type: 'response_item',
        payload: {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'first answer' }],
        },
        timestamp: '2026-08-20T08:03:17.000Z',
      },
    ];
    writeFileSync(originalPath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  });

  afterEach(() => {
    if (oldCodexHomeDir === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = oldCodexHomeDir;
    }

    vi.resetModules();
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  const readMeta = (path: string) => JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]).payload;

  it('rewrites the thread id so the copy gets its own thread-store entry', async () => {
    const { forkCodexSession } = await import('./codexSessionFork');
    const result = await forkCodexSession(sessionUuid);

    expect(result.success).toBe(true);
    const meta = readMeta(result.newFilePath!);

    // The id inside the file must match the filename, otherwise Codex rejects
    // thread/resume with "already has an active writer" while the source runs.
    const filenameUuid = basename(result.newFilePath!).match(/rollout-.+?-([0-9a-f-]{36})\.jsonl$/)![1];
    expect(meta.session_id).toBe(filenameUuid);
    expect(meta.id).toBe(filenameUuid);
    expect(meta.session_id).not.toBe(sessionUuid);

    // Everything else is untouched
    expect(meta.cwd).toBe('/workspace/happy');
    expect(readMeta(originalPath).session_id).toBe(sessionUuid);
    expect(readFileSync(result.newFilePath!, 'utf-8').split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('rewrites the thread id when truncating too', async () => {
    const { forkAndTruncateCodexSession, } = await import('./codexSessionFork');
    const { generateStableUuid } = await import('./codexSessionReader');

    const truncateUuid = generateStableUuid('2026-08-20T08:03:16.000Z', 0);
    const result = await forkAndTruncateCodexSession(sessionUuid, truncateUuid);

    expect(result.success).toBe(true);
    const meta = readMeta(result.newFilePath!);
    expect(meta.session_id).not.toBe(sessionUuid);
    expect(meta.id).toBe(meta.session_id);

    // session_meta survives, the truncated user turn and everything after does not
    const kept = readFileSync(result.newFilePath!, 'utf-8').split('\n').filter(Boolean);
    expect(kept).toHaveLength(1);
  });
});
