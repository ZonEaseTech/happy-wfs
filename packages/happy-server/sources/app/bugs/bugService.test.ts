import { describe, expect, it } from 'vitest';
import { buildBugTitle, normalizeBugStatusChange } from './bugService';

describe('bugService pure helpers', () => {
    it('generates compact titles from descriptions', () => {
        expect(buildBugTitle('  页面空白，控制台有 500 错误  ')).toBe('页面空白，控制台有 500 错误');
        expect(buildBugTitle('测'.repeat(50))).toBe(`${'测'.repeat(36)}…`);
    });

    it('normalizes return-to-pending as a pending status with explicit action', () => {
        expect(normalizeBugStatusChange('verify', { status: 'pending', action: 'return_to_pending' })).toEqual({
            fromStatus: 'verify',
            toStatus: 'pending',
            action: 'return_to_pending',
        });
    });

    it('normalizes close as closed action', () => {
        expect(normalizeBugStatusChange('in_progress', { status: 'closed' })).toEqual({
            fromStatus: 'in_progress',
            toStatus: 'closed',
            action: 'closed',
        });
    });
});
