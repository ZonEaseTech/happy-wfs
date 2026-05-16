import { describe, expect, it } from 'vitest';
import { buildCopyToAgentBriefPrompt } from './sessionCopyPrompt';

describe('buildCopyToAgentBriefPrompt', () => {
    it('asks the target agent to generate and use a Happy task brief for the source session', () => {
        expect(buildCopyToAgentBriefPrompt({ sessionId: 'cmp40vw8305tco014upxv5bok', projectPath: '/workspace' })).toBe(
            '请运行 `happy task brief --session cmp40vw8305tco014upxv5bok --project /workspace` 为该会话生成接力包，然后基于接力包继续任务。保留已有用户改动，并汇报验证结果。'
        );
    });

    it('quotes project paths with spaces', () => {
        expect(buildCopyToAgentBriefPrompt({ sessionId: 'session-1', projectPath: '/Users/me/My Project' })).toContain(
            "--project '/Users/me/My Project'"
        );
    });
});
