import { Ionicons } from '@expo/vector-icons';

export type ConfigTarget = {
    key: 'claude' | 'codex' | 'gemini';
    title: string;
    subtitle: string;
    fileName: string;
    dirName: string;
    language: string;
    validateJson?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
};

export const CONFIG_TARGETS: ConfigTarget[] = [
    { key: 'claude', title: 'Claude', subtitle: '~/.claude/settings.json · mcpServers', fileName: '.claude/settings.json', dirName: '.claude', language: 'JSON', validateJson: true, icon: 'sparkles-outline', color: '#5856D6' },
    { key: 'codex', title: 'Codex', subtitle: '~/.codex/config.toml · [mcp_servers.*]', fileName: '.codex/config.toml', dirName: '.codex', language: 'TOML', icon: 'code-slash-outline', color: '#111111' },
    { key: 'gemini', title: 'Gemini', subtitle: '~/.gemini/settings.json · mcpServers', fileName: '.gemini/settings.json', dirName: '.gemini', language: 'JSON', validateJson: true, icon: 'diamond-outline', color: '#AF52DE' },
];
