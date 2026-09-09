/**
 * Generate GitHub-style adjective-noun combinations for worktree names
 */

const adjectives = [
    'clever', 'happy', 'swift', 'bright', 'calm',
    'bold', 'quiet', 'brave', 'wise', 'eager',
    'gentle', 'quick', 'sharp', 'smooth', 'fresh',
    'vivid', 'noble', 'keen', 'warm', 'fair',
    'lucky', 'proud', 'neat', 'clear', 'light',
];

const nouns = [
    'ocean', 'forest', 'cloud', 'star', 'river',
    'mountain', 'valley', 'bridge', 'beacon', 'harbor',
    'garden', 'meadow', 'canyon', 'island', 'desert',
    'aurora', 'breeze', 'coral', 'summit', 'lagoon',
    'glacier', 'prairie', 'reef', 'ridge', 'spring',
];

// Lowercase alphanumerics only: the name ends up in both a git branch name and
// a directory name, so it has to stay safe for each.
const suffixChars = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

const SUFFIX_LENGTH = 4;

function randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}

function randomSuffix(): string {
    return Array.from({ length: SUFFIX_LENGTH }, () => randomChoice(suffixChars)).join('');
}

/**
 * adjective-noun alone is only 25x25 = 625 combinations, and nothing checks the
 * existing branches before using it, so `git worktree add -b` started failing
 * with "a branch named ... already exists" after a few dozen worktrees (birthday
 * paradox: >50% odds by ~30 names). The suffix takes it to 625 * 36^4 ≈ 1.05e9.
 *
 * This matters most for createWorkspace(), which shares one branch name across
 * every repo in the workspace and — unlike createWorktree() — has no retry, so a
 * single collision rolls the whole workspace back.
 */
export function generateWorktreeName(): string {
    const adjective = randomChoice(adjectives);
    const noun = randomChoice(nouns);
    return `${adjective}-${noun}-${randomSuffix()}`;
}