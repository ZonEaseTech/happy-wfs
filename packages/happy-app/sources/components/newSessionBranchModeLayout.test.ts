import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const newSessionSource = readFileSync(resolve(__dirname, '../app/(app)/new/index.tsx'), 'utf8');

describe('new session branch mode layout', () => {
    it('uses a compact branch-mode picker above the worktree repo selector', () => {
        expect(newSessionSource).toContain('branchModeMenuVisible');
        expect(newSessionSource).toContain('const branchModeSelector = sessionType === \'worktree\' && selectedMachineId ?');
        expect(newSessionSource).toContain('{branchModeSelector}\n                                <RepoPickerBar');
        expect(newSessionSource).toContain('{branchModeSelector}\n                                            <RepoPickerBar');
        expect(newSessionSource).not.toContain('selectedRepos.length > 0 && (\n                                                <View style={{ flexDirection: \'row\', borderRadius: 8');
    });
});
