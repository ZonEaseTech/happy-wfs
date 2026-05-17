import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

describe('custom quick actions sync storage', () => {
    it('saves custom quick actions through synced account settings entry points', () => {
        const files = [
            resolve(sourceRoot, 'app/(app)/new/index.tsx'),
            resolve(sourceRoot, '-session/SessionView.tsx'),
        ];

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            expect(source).toContain("useSettingMutable('customQuickActions')");
            expect(source).not.toContain("const [customQuickActions, setCustomQuickActions] = useLocalSettingMutable('customQuickActions')");
        }
    });

    it('keeps the session-id prompt when the task brief action is customized', () => {
        const source = readFileSync(resolve(sourceRoot, 'app/(app)/new/index.tsx'), 'utf8');
        expect(source).toContain('isCustomTaskBriefAction');
        expect(source).toContain('resolvePrompt: isCustomTaskBriefAction(action, defaultQuickActions[0]) ? resolveTaskBriefPrompt : undefined');
    });
});
