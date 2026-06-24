import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const newSessionSource = readFileSync(resolve(__dirname, '../app/(app)/new/index.tsx'), 'utf8');

describe('new session branch mode layout', () => {
    it('places the compact branch-mode picker inside the worktree option', () => {
        expect(newSessionSource).toContain('branchModeMenuVisible');
        expect(newSessionSource).toContain('const branchModeSelector = sessionType === \'worktree\' && selectedMachineId ?');
        expect(newSessionSource).toContain('worktreeAccessory={branchModeSelector}');
        expect(newSessionSource).not.toContain('{branchModeSelector}\n                                <RepoPickerBar');
        expect(newSessionSource).not.toContain('{branchModeSelector}\n                                            <RepoPickerBar');
        expect(newSessionSource).not.toContain('selectedRepos.length > 0 && (\n                                                <View style={{ flexDirection: \'row\', borderRadius: 8');
    });
});
