import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(__dirname, '../../../prisma/migrations/20260704060000_repair_bug_report_deleted_at/migration.sql');

describe('BugReport deletedAt repair migration', () => {
    it('adds deletedAt idempotently for databases that already applied the initial bug migration', () => {
        expect(existsSync(migrationPath)).toBe(true);
        const sql = readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('ALTER TABLE "BugReport" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)');
        expect(sql).toContain('CREATE INDEX IF NOT EXISTS "BugReport_ownerId_deletedAt_lastActivityAt_idx"');
    });
});
