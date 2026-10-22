import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { getDiffDetail, saveDiffRecords, type DiffRecord } from './diffStore';

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/happy-cli-test-home',
    },
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

const diffsDir = join(configuration.happyHomeDir, 'diffs');
const testSessionId = 'test-session-diff-store';
const filePath = join(diffsDir, `${testSessionId}.jsonl`);
const legacyFilePath = join(diffsDir, `${testSessionId}.json`);

function diffRecord(overrides: Partial<DiffRecord>): DiffRecord {
    return {
        callId: 'call-1',
        agent: 'codex',
        filePath: '/repo/a.ts',
        diff: '@@ -1 +1 @@',
        additions: 1,
        deletions: 1,
        timestamp: Date.now(),
        ...overrides,
    };
}

describe('diffStore', () => {
    function removeFiles() {
        for (const path of [filePath, legacyFilePath]) {
            if (existsSync(path)) rmSync(path);
        }
    }

    beforeEach(removeFiles);
    afterEach(removeFiles);

    it('finds a record by callId and filePath', async () => {
        saveDiffRecords(testSessionId, [
            diffRecord({ filePath: '/repo/a.ts', diff: 'diff-a' }),
            diffRecord({ filePath: '/repo/b.ts', diff: 'diff-b', additions: 3, deletions: 0 }),
        ]);

        expect(await getDiffDetail(testSessionId, 'call-1', '/repo/b.ts')).toEqual({
            diff: 'diff-b',
            additions: 3,
            deletions: 0,
        });
        expect(await getDiffDetail(testSessionId, 'call-1', '/repo/c.ts')).toBeNull();
        expect(await getDiffDetail(testSessionId, 'call-2', '/repo/a.ts')).toBeNull();
        expect(readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('still reads records that older versions wrote as a JSON array', async () => {
        mkdirSync(diffsDir, { recursive: true });
        writeFileSync(legacyFilePath, JSON.stringify([diffRecord({ callId: 'old-call', diff: 'old-diff' })]));
        saveDiffRecords(testSessionId, [diffRecord({ callId: 'new-call', diff: 'new-diff' })]);

        expect((await getDiffDetail(testSessionId, 'old-call', '/repo/a.ts'))?.diff).toBe('old-diff');
        expect((await getDiffDetail(testSessionId, 'new-call', '/repo/a.ts'))?.diff).toBe('new-diff');
    });

    it('returns null for a session with no records', async () => {
        expect(await getDiffDetail('missing-session', 'call-1', '/repo/a.ts')).toBeNull();
    });
});
