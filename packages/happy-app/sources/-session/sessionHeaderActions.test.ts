import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sessionViewSource = readFileSync(resolve(__dirname, 'SessionView.tsx'), 'utf8');

describe('session header actions', () => {
    it('does not show the quick-copy session id or injected memories actions in the mobile header', () => {
        expect(sessionViewSource).not.toContain('finger-print-outline');
        expect(sessionViewSource).not.toContain('setInjectedMemoriesOpen(true)');
    });
});
