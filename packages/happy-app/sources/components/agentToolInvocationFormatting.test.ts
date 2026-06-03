import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('agent tool invocation sanitization', () => {
    it('only enables raw invoke-block formatting for agent chat messages', () => {
        const messageView = read('components/MessageView.tsx');
        expect(messageView).toContain('formatAssistantToolInvocations={true}');

        const markdownView = read('components/markdown/MarkdownView.tsx');
        expect(markdownView).toContain('formatAssistantToolInvocations?: boolean');
        expect(markdownView).toContain('if (!props.formatAssistantToolInvocations) return props.markdown;');
        expect(markdownView).toContain('return formatAssistantToolInvocations(props.markdown);');
    });
});
