export type McpTarget = 'claude' | 'codex' | 'gemini';
export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServer {
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    /** Per-server keys the codec did not recognize, preserved on round-trip. */
    extras?: Record<string, unknown>;
}

// Keys a JSON codec recognizes; everything else goes to `extras`.
const JSON_KNOWN_KEYS = ['type', 'command', 'args', 'env', 'url', 'httpUrl', 'headers'];

export function parseMcpServers(content: string, target: McpTarget): McpServer[] {
    if (target === 'codex') return parseCodexServers(content);
    return parseJsonServers(content, target);
}

function parseJsonServers(content: string, target: McpTarget): McpServer[] {
    const trimmed = content.trim();
    const root = trimmed ? JSON.parse(trimmed) : {};
    const mcp = root?.mcpServers;
    if (!mcp || typeof mcp !== 'object') return [];
    return Object.entries(mcp).map(([name, raw]) =>
        jsonEntryToServer(name, (raw ?? {}) as Record<string, unknown>, target),
    );
}

function jsonEntryToServer(name: string, entry: Record<string, unknown>, target: McpTarget): McpServer {
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
        if (!JSON_KNOWN_KEYS.includes(k)) extras[k] = v;
    }
    const extrasOrUndef = Object.keys(extras).length ? extras : undefined;
    const headers = entry.headers as Record<string, string> | undefined;

    if (target === 'gemini') {
        if (typeof entry.httpUrl === 'string') {
            return { name, transport: 'http', url: entry.httpUrl, headers, extras: extrasOrUndef };
        }
        if (typeof entry.url === 'string') {
            return { name, transport: 'sse', url: entry.url, headers, extras: extrasOrUndef };
        }
    } else {
        if (entry.type === 'http' || entry.type === 'sse') {
            return { name, transport: entry.type, url: entry.url as string, headers, extras: extrasOrUndef };
        }
        if (typeof entry.url === 'string') {
            return { name, transport: 'http', url: entry.url, headers, extras: extrasOrUndef };
        }
    }
    return {
        name,
        transport: 'stdio',
        command: entry.command as string | undefined,
        args: entry.args as string[] | undefined,
        env: entry.env as Record<string, string> | undefined,
        extras: extrasOrUndef,
    };
}

// parseCodexServers defined in Task 4 — leave a stub that Task 4 replaces:
function parseCodexServers(_content: string): McpServer[] {
    throw new Error('not implemented');
}
