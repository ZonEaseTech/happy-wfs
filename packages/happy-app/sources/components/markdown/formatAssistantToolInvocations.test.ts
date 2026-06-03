import { describe, expect, it } from 'vitest';
import { formatAssistantToolInvocations } from './formatAssistantToolInvocations';

describe('formatAssistantToolInvocations', () => {
    it('formats standalone TaskUpdate invoke blocks as readable assistant markdown', () => {
        const markdown = [
            '两份计划都写好了：',
            '',
            '<invoke name="TaskUpdate">',
            '',
            '<parameter name="taskId">24</parameter>',
            '',
            '<parameter name="status">completed</parameter>',
            '',
            '</invoke>',
            '',
            'course',
        ].join('\n');

        expect(formatAssistantToolInvocations(markdown)).toBe([
            '两份计划都写好了：',
            '',
            '> 系统动作：已更新任务 #24：completed',
            '',
            'course',
        ].join('\n'));
    });

    it('formats unknown invoke blocks without exposing raw XML', () => {
        const markdown = [
            '<invoke name="SomeTool">',
            '<parameter name="foo">bar</parameter>',
            '</invoke>',
        ].join('\n');

        expect(formatAssistantToolInvocations(markdown)).toBe('> 系统动作：已执行 SomeTool');
    });

    it('preserves invoke examples inside fenced code blocks', () => {
        const markdown = [
            '示例：',
            '',
            '```xml',
            '<invoke name="TaskUpdate">',
            '<parameter name="taskId">24</parameter>',
            '</invoke>',
            '```',
        ].join('\n');

        expect(formatAssistantToolInvocations(markdown)).toContain('<invoke name="TaskUpdate">');
    });
});
