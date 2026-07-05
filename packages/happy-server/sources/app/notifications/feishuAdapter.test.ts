import { describe, expect, it } from 'vitest';
import { buildMentionNotificationCard } from './feishuAdapter';

describe('buildMentionNotificationCard', () => {
    it('builds one text notification with Happy mention names and truncates the note body to 500 chars', () => {
        const payload = buildMentionNotificationCard({
            actorName: 'Alice',
            recipientUsernames: ['youthqx', 'wfs'],
            sessionTitle: '支付问题排查',
            sessionUrl: 'https://happy.zonease.org/session/session-1',
            preview: 'x'.repeat(501),
        });

        expect(payload.msg_type).toBe('text');
        if (payload.msg_type !== 'text') {
            throw new Error('expected text payload');
        }
        const text = payload.content.text;
        expect(text).toContain('协作 @ 通知');
        expect(text).toContain('发起人：Alice');
        expect(text).toContain('被 @：@youthqx、@wfs');
        expect(text).toContain('会话：支付问题排查');
        expect(text).toContain(`内容：${'x'.repeat(499)}…`);
        expect(text).not.toContain('x'.repeat(501));
        expect(text).toContain('https://happy.zonease.org/session/session-1');
    });
});
