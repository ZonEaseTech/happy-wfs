import { describe, expect, it } from 'vitest';
import { formatMessageTime } from './messageTime';

describe('formatMessageTime', () => {
    const now = new Date(2026, 10, 19, 15, 30).getTime();

    it('shows only the time for a message sent today, in the app language', () => {
        const sent = new Date(2026, 10, 19, 13, 26).getTime();
        expect(formatMessageTime(sent, 'zh-Hans', now)).toBe('13:26');
        expect(formatMessageTime(sent, 'en', now)).toMatch(/^1:26\sPM$/);
    });

    it('adds the month and day for an earlier day this year', () => {
        const sent = new Date(2026, 10, 18, 9, 5).getTime();
        expect(formatMessageTime(sent, 'zh-Hans', now)).toBe('11/18 9:05');
    });

    it('adds the year for a message from an earlier year', () => {
        const sent = new Date(2025, 11, 31, 8, 0).getTime();
        expect(formatMessageTime(sent, 'zh-Hans', now)).toBe('2025/12/31 8:00');
    });
});
