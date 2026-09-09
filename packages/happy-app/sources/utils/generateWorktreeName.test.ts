import { describe, expect, it } from 'vitest';
import { generateWorktreeName } from './generateWorktreeName';

describe('generateWorktreeName', () => {
    it('keeps the adjective-noun shape and appends a 4-char suffix', () => {
        for (let i = 0; i < 200; i++) {
            // Only lowercase alphanumerics and dashes: the value becomes both a
            // git branch name and a directory name.
            expect(generateWorktreeName()).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{4}$/);
        }
    });

    it('rarely repeats, so `git worktree add -b` stops colliding', () => {
        // Without the suffix this is 625 combinations and 500 draws collide with
        // near-certainty. With it, duplicates should be virtually absent.
        const names = new Set<string>();
        for (let i = 0; i < 500; i++) {
            names.add(generateWorktreeName());
        }
        expect(names.size).toBe(500);
    });
});
