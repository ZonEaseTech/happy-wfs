import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverCodexSkills } from './skillDiscovery';

let tempDirs: string[] = [];

function makeHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'happy-skill-discovery-'));
    tempDirs.push(dir);
    return dir;
}

function writeSkill(home: string, relativeDir: string, body: string) {
    const dir = join(home, relativeDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), body);
}

afterEach(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
});

describe('discoverCodexSkills', () => {
    it('discovers local and plugin skills from SKILL.md frontmatter', () => {
        const home = makeHome();
        writeSkill(home, '.agents/skills/pma', [
            '---',
            'name: pma',
            'description: Project management assistant',
            '---',
            '# PMA',
        ].join('\n'));
        writeSkill(home, '.codex/skills/.system/imagegen', [
            '---',
            'name: imagegen',
            'description: Generate images',
            '---',
            '# Imagegen',
        ].join('\n'));
        writeSkill(home, '.codex/.tmp/plugins/plugins/superpowers/skills/writing-plans', [
            '---',
            'name: writing-plans',
            'description: Write implementation plans',
            '---',
            '# Writing Plans',
        ].join('\n'));

        writeSkill(home, '.codex/plugins/cache/superpowers/1.0.0/skills/brainstorming', [
            '---',
            'name: brainstorming',
            'description: Explore ideas before building',
            '---',
        ].join('\n'));

        const skills = discoverCodexSkills({ homeDir: home, includePluginCache: true });

        // The marketplace copy under .codex/.tmp is not what is installed.
        expect(skills).toEqual([
            { name: 'pma', description: 'Project management assistant', source: 'agents' },
            { name: 'imagegen', description: 'Generate images', source: 'codex' },
            { name: 'brainstorming', description: 'Explore ideas before building', source: 'codex-plugin-cache' },
        ]);
    });

    it('cuts long descriptions to one short line', () => {
        const home = makeHome();
        writeSkill(home, '.codex/skills/long', ['---', 'name: long', `description: ${'很长的说明'.repeat(60)}`, '---'].join('\n'));

        const [skill] = discoverCodexSkills({ homeDir: home, includePluginCache: false });

        expect(skill.description!.length).toBe(120);
        expect(skill.description!.endsWith('…')).toBe(true);
    });

    it('deduplicates by skill name and falls back to parent directory name', () => {
        const home = makeHome();
        writeSkill(home, '.agents/skills/first', [
            '---',
            'name: shared',
            'description: First wins',
            '---',
        ].join('\n'));
        writeSkill(home, '.codex/skills/shared', [
            '---',
            'name: shared',
            'description: Duplicate loses',
            '---',
        ].join('\n'));
        writeSkill(home, '.claude/skills/no-frontmatter', '# No frontmatter');

        const skills = discoverCodexSkills({ homeDir: home, includePluginCache: false });

        expect(skills).toEqual([
            { name: 'shared', description: 'First wins', source: 'agents' },
            { name: 'no-frontmatter', description: undefined, source: 'claude' },
        ]);
    });

    it('parses folded multiline descriptions', () => {
        const home = makeHome();
        writeSkill(home, '.claude/skills/dev-task', [
            '---',
            'name: dev-task',
            'description: >-',
            '  Dispatch several tasks,',
            '  then summarize results.',
            '---',
        ].join('\n'));

        const skills = discoverCodexSkills({ homeDir: home, includePluginCache: false });

        expect(skills).toEqual([
            { name: 'dev-task', description: 'Dispatch several tasks, then summarize results.', source: 'claude' },
        ]);
    });
});
