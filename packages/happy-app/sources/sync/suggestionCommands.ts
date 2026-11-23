/**
 * Suggestion commands functionality for slash commands
 * Reads commands directly from session metadata storage
 */

import Fuse from 'fuse.js';
import { getSession, storage } from './storage';
import type { Metadata } from './storageTypes';

export interface CommandItem {
    command: string;        // The command without slash (e.g., "compact")
    description?: string;   // Optional description of what the command does
    kind?: 'command' | 'skill';
    insertText?: string;    // Optional text inserted when the suggestion is selected
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
    kind?: 'command' | 'skill';
}

// Commands to ignore/filter out
export const IGNORED_COMMANDS = [
    "add-dir",
    "agents",
    "config",
    "statusline",
    "bashes",
    "settings",
    "cost",
    "doctor",
    "exit",
    "help",
    "ide",
    "init",
    "install-github-app",
    "mcp",
    "memory",
    "migrate-installer",
    "model",
    "pr-comments",
    "release-notes",
    "resume",
    "status",
    "bug",
    "review",
    "security-review",
    "terminal-setup",
    "upgrade",
    "vim",
    "permissions",
    "hooks",
    "export",
    "logout",
    "login"
];

// Default commands always available for all session types
const DEFAULT_COMMANDS: CommandItem[] = [
    { command: 'clear', description: 'Clear the conversation' },
];

// Commands only available for Claude sessions
const CLAUDE_COMMANDS: CommandItem[] = [
    { command: 'compact', description: 'Compact the conversation history' },
];

// Commands available for sessions with forkable history (Claude, Gemini, Codex)
const FORKABLE_COMMANDS: CommandItem[] = [
    { command: 'duplicate', description: 'Duplicate conversation from a specific point' },
];

// Superpowers are skills, not native slash commands. These shortcuts provide
// a familiar slash-command discovery surface and insert the corresponding
// skill request as normal chat text.
const SUPERPOWERS_SHORTCUT_COMMANDS: CommandItem[] = [
    {
        command: 'brainstorm',
        description: 'Use brainstorming skill to clarify and design the work',
        insertText: '请使用 brainstorming skill 和我一起梳理需求。',
    },
    {
        command: 'plan',
        description: 'Use writing-plans skill to create an implementation plan',
        insertText: '请使用 writing-plans skill 为当前任务制定实施计划。',
    },
    {
        command: 'debug',
        description: 'Use systematic-debugging skill to investigate a problem',
        insertText: '请使用 systematic-debugging skill 系统排查这个问题。',
    },
    {
        command: 'tdd',
        description: 'Use test-driven-development skill to implement with RED/GREEN/REFACTOR',
        insertText: '请使用 test-driven-development skill 按红绿重构实现。',
    },
    {
        command: 'verify',
        description: 'Use verification-before-completion skill before claiming completion',
        insertText: '请使用 verification-before-completion skill 验证当前改动并汇报结果。',
    },
    {
        command: 'review',
        description: 'Use requesting-code-review skill to review the current changes',
        insertText: '请使用 requesting-code-review skill 对当前改动做代码审查。',
    },
];

// Command descriptions for known tools/commands
const COMMAND_DESCRIPTIONS: Record<string, string> = {
    // Default commands
    compact: 'Compact the conversation history',
    duplicate: 'Duplicate conversation from a specific point',

    // Common tool commands
    help: 'Show available commands',
    clear: 'Clear the conversation',
    reset: 'Reset the session',
    export: 'Export conversation',
    debug: 'Show debug information',
    status: 'Show connection status',
    stop: 'Stop current operation',
    abort: 'Abort current operation',
    cancel: 'Cancel current operation',
    
    // Add more descriptions as needed
};

// Commands the agent itself reports (slash commands and skills), shared by
// live sessions and by the new-session composer.
function pushMetadataCommands(commands: CommandItem[], metadata: Pick<Metadata, 'slashCommands' | 'skills'> | null) {
    for (const cmd of SUPERPOWERS_SHORTCUT_COMMANDS) {
        if (!commands.find(c => c.command === cmd.command && (c.kind ?? 'command') === 'command')) {
            commands.push(cmd);
        }
    }
    
    // Add commands from metadata.slashCommands (filter with ignore list)
    if (metadata?.slashCommands) {
        for (const cmd of metadata.slashCommands) {
            // Skip if in ignore list
            if (IGNORED_COMMANDS.includes(cmd)) continue;
            
            // Check if it's already in default commands
            if (!commands.find(c => c.command === cmd)) {
                commands.push({
                    command: cmd,
                    description: COMMAND_DESCRIPTIONS[cmd]  // Optional description
                });
            }
        }
    }

    // Add Codex/agent skills from metadata. They are offered in the slash
    // discovery popup, but selecting them inserts the Codex skill trigger form
    // (`$skill`) rather than pretending they are slash commands.
    if (metadata?.skills) {
        for (const skill of metadata.skills) {
            const name = skill.name?.trim();
            if (!name) continue;
            if (commands.find(c => c.command === name && c.kind === 'skill')) continue;
            commands.push({
                command: name,
                description: skill.description,
                kind: 'skill',
            });
        }
    }
}

// Get commands from session metadata
function getCommandsFromSession(sessionId: string): CommandItem[] {
    const session = getSession(sessionId);
    if (!session || !session.metadata) {
        return DEFAULT_COMMANDS;
    }

    const commands: CommandItem[] = [...DEFAULT_COMMANDS];

    // Add Claude-specific commands
    if (session.metadata.claudeSessionId) {
        commands.push(...CLAUDE_COMMANDS);
    }

    // Add forkable commands for sessions with session history (Claude, Gemini, Codex)
    if (session.metadata.claudeSessionId || session.metadata.flavor === 'gemini' || session.metadata.codexSessionId) {
        commands.push(...FORKABLE_COMMANDS);
    }

    pushMetadataCommands(commands, session.metadata);
    
    return commands;
}

export interface DraftCommandSource {
    machineId: string | null | undefined;
    path?: string | null;
    agentType: string;
}

// A session that has not started yet has no metadata of its own. The agent
// reports its slash commands and skills when it starts, so borrow them from
// the most recent session of the same agent on the same machine, preferring
// one in the same directory (project-level skills differ per directory).
// Commands that act on an existing conversation (clear, compact, duplicate)
// are left out.
function getCommandsForDraft(source: DraftCommandSource): CommandItem[] {
    const commands: CommandItem[] = [];
    let best: { metadata: Metadata; samePath: boolean; activeAt: number } | null = null;
    for (const session of Object.values(storage.getState().sessions)) {
        const metadata = session.metadata;
        if (!source.machineId || !metadata || metadata.machineId !== source.machineId) continue;
        if ((metadata.flavor ?? 'claude') !== source.agentType) continue;
        if (!metadata.slashCommands?.length && !metadata.skills?.length) continue;
        const samePath = !!source.path && metadata.path === source.path;
        const activeAt = session.activeAt ?? 0;
        if (!best
            || (samePath && !best.samePath)
            || (samePath === best.samePath && activeAt > best.activeAt)) {
            best = { metadata, samePath, activeAt };
        }
    }

    pushMetadataCommands(commands, best?.metadata ?? null);
    return commands;
}

function searchCommandList(commands: CommandItem[], query: string, options: SearchOptions): CommandItem[] {
    const { limit = 10, threshold = 0.3, kind } = options;
    const filtered = commands.filter(cmd => !kind || (cmd.kind ?? 'command') === kind);

    // If query is empty, return all commands
    if (!query || query.trim().length === 0) {
        return filtered.slice(0, limit);
    }

    // Setup Fuse for fuzzy search
    const fuse = new Fuse(filtered, {
        keys: [
            { name: 'command', weight: 0.7 },
            { name: 'description', weight: 0.3 }
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true
    });
    return fuse.search(query, { limit }).map(result => result.item);
}

export async function searchDraftCommands(
    source: DraftCommandSource,
    query: string,
    options: SearchOptions = {}
): Promise<CommandItem[]> {
    return searchCommandList(getCommandsForDraft(source), query, options);
}

// Main export: search commands with fuzzy matching
export async function searchCommands(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): Promise<CommandItem[]> {
    // Get commands from session metadata (no caching)
    return searchCommandList(getCommandsFromSession(sessionId), query, options);
}

// Get all available commands for a session
export function getAllCommands(sessionId: string): CommandItem[] {
    return getCommandsFromSession(sessionId);
}
