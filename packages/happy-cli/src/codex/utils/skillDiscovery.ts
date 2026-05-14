import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface CodexSkillMetadata {
    name: string;
    description?: string;
    source?: string;
}

export interface DiscoverCodexSkillsOptions {
    homeDir?: string;
    maxSkills?: number;
    maxDepth?: number;
    includePluginCache?: boolean;
}

const DEFAULT_MAX_SKILLS = 400;
const DEFAULT_MAX_DEPTH = 10;
const SKILL_FILE = 'SKILL.md';
const IGNORED_DIRECTORIES = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'references',
    'assets',
    'templates',
]);

function parseFrontMatter(content: string): { name?: string; description?: string } {
    if (!content.startsWith('---')) return {};
    const end = content.indexOf('\n---', 3);
    if (end < 0) return {};
    const block = content.slice(3, end).split(/\r?\n/);
    const result: { name?: string; description?: string } = {};

    for (let i = 0; i < block.length; i++) {
        const line = block[i];
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
        if (!match) continue;
        const [, key, rawValue] = match;
        let value = rawValue.trim().replace(/^['"]|['"]$/g, '');
        if ((rawValue.trim() === '>-' || rawValue.trim() === '>' || rawValue.trim() === '|-' || rawValue.trim() === '|') && key === 'description') {
            const continuation: string[] = [];
            while (i + 1 < block.length && /^\s+/.test(block[i + 1])) {
                i++;
                continuation.push(block[i].trim());
            }
            value = continuation.join(rawValue.trim().startsWith('|') ? '\n' : ' ').trim();
        }
        if (key === 'name' && value) result.name = value;
        if (key === 'description' && value) result.description = value;
    }

    return result;
}

function deriveSkillName(skillFilePath: string): string {
    return basename(dirname(skillFilePath));
}

function collectSkillFiles(root: string, maxDepth: number, maxFiles: number): string[] {
    const files: string[] = [];

    function walk(dir: string, depth: number) {
        if (files.length >= maxFiles || depth > maxDepth) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (files.length >= maxFiles) return;
            const fullPath = join(dir, entry.name);
            if (entry.isFile() && entry.name === SKILL_FILE) {
                files.push(fullPath);
                continue;
            }
            if (!entry.isDirectory()) continue;
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            walk(fullPath, depth + 1);
        }
    }

    if (existsSync(root)) {
        walk(root, 0);
    }

    return files;
}

function skillRoots(homeDir: string, includePluginCache: boolean): Array<{ path: string; source: string }> {
    const roots = [
        { path: join(homeDir, '.agents', 'skills'), source: 'agents' },
        { path: join(homeDir, '.codex', 'skills'), source: 'codex' },
        { path: join(homeDir, '.claude', 'skills'), source: 'claude' },
    ];

    if (includePluginCache) {
        roots.push(
            { path: join(homeDir, '.codex', 'plugins', 'cache'), source: 'codex-plugin-cache' },
            { path: join(homeDir, '.codex', '.tmp', 'plugins', 'plugins'), source: 'codex-plugin-marketplace' },
        );
    }

    return roots;
}

export function discoverCodexSkills(options: DiscoverCodexSkillsOptions = {}): CodexSkillMetadata[] {
    const homeDir = options.homeDir ?? homedir();
    const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const includePluginCache = options.includePluginCache ?? true;
    const result: CodexSkillMetadata[] = [];
    const seen = new Set<string>();

    for (const root of skillRoots(homeDir, includePluginCache)) {
        if (result.length >= maxSkills) break;
        const skillFiles = collectSkillFiles(root.path, maxDepth, maxSkills - result.length);

        for (const skillFile of skillFiles) {
            if (result.length >= maxSkills) break;
            let content = '';
            try {
                content = readFileSync(skillFile, 'utf8');
            } catch {
                continue;
            }

            const frontMatter = parseFrontMatter(content);
            const name = (frontMatter.name || deriveSkillName(skillFile)).trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({
                name,
                description: frontMatter.description,
                source: root.source,
            });
        }
    }

    return result;
}
