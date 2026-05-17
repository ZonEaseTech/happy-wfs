import { Ionicons } from '@expo/vector-icons';
import type { McpTarget } from '@/utils/mcpConfig';

export type ConfigTarget = {
    key: 'claude' | 'claude-settings' | 'codex' | 'gemini';
    title: string;
    subtitle: string;
    fileName: string;
    dirName: string;
    language: string;
    validateJson?: boolean;
    codecTarget: McpTarget;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
};

export const CONFIG_TARGETS: ConfigTarget[] = [
    { key: 'claude', title: 'Claude', subtitle: '~/.codex/.mcp.json · mcpServers', fileName: '.codex/.mcp.json', dirName: '.codex', language: 'JSON', validateJson: true, codecTarget: 'claude', icon: 'sparkles-outline', color: '#5856D6' },
    { key: 'claude-settings', title: 'Claude settings', subtitle: '~/.claude/settings.json · mcpServers', fileName: '.claude/settings.json', dirName: '.claude', language: 'JSON', validateJson: true, codecTarget: 'claude', icon: 'settings-outline', color: '#5856D6' },
    { key: 'codex', title: 'Codex', subtitle: '~/.codex/config.toml · [mcp_servers.*]', fileName: '.codex/config.toml', dirName: '.codex', language: 'TOML', codecTarget: 'codex', icon: 'code-slash-outline', color: '#111111' },
    { key: 'gemini', title: 'Gemini', subtitle: '~/.gemini/settings.json · mcpServers', fileName: '.gemini/settings.json', dirName: '.gemini', language: 'JSON', validateJson: true, codecTarget: 'gemini', icon: 'diamond-outline', color: '#AF52DE' },
];
