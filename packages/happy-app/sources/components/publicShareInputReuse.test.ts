import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public share input', () => {
    it('uses the shared AgentInput instead of a custom text input', () => {
        const source = readFileSync(join(process.cwd(), 'sources/app/(app)/share/[token].tsx'), 'utf8');

        expect(source).toContain('<AgentInput');
        expect(source).not.toContain('function PublicChatInput');
        expect(source).not.toContain('TextInput');
    });

    it('wires the shared stop button and abort handler for public chat', () => {
        const source = readFileSync(join(process.cwd(), 'sources/app/(app)/share/[token].tsx'), 'utf8');
        const inputSource = readFileSync(join(process.cwd(), 'sources/components/AgentInput.tsx'), 'utf8');

        expect(source).toContain('onAbort={abortMessage}');
        expect(source).toContain('onAbort={onAbort}');
        expect(source).toContain('showAbortButton={canAbort}');
        expect(inputSource).toContain('props.onAbort && props.showAbortButton');
        expect(inputSource).toContain('name="stop-circle-outline"');
    });
});
