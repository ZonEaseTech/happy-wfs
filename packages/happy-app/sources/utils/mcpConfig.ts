import { parse as parseToml } from 'smol-toml';

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
    if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return [];
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

// Codex MCP table keys the codec recognizes.
const CODEX_KNOWN_KEYS = ['command', 'args', 'env', 'url', 'http_headers'];

function parseCodexServers(content: string): McpServer[] {
    const trimmed = content.trim();
    const root = trimmed ? (parseToml(trimmed) as Record<string, unknown>) : {};
    const mcp = root.mcp_servers as Record<string, unknown> | undefined;
    if (!mcp || typeof mcp !== 'object') return [];
    return Object.entries(mcp).map(([name, raw]) =>
        codexTableToServer(name, (raw ?? {}) as Record<string, unknown>),
    );
}

function codexTableToServer(name: string, table: Record<string, unknown>): McpServer {
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(table)) {
        if (!CODEX_KNOWN_KEYS.includes(k)) extras[k] = v;
    }
    const extrasOrUndef = Object.keys(extras).length ? extras : undefined;
    if (typeof table.url === 'string') {
        return {
            name, transport: 'http', url: table.url,
            headers: table.http_headers as Record<string, string> | undefined,
            extras: extrasOrUndef,
        };
    }
    return {
        name, transport: 'stdio',
        command: table.command as string | undefined,
        args: table.args as string[] | undefined,
        env: table.env as Record<string, string> | undefined,
        extras: extrasOrUndef,
    };
}

export function applyMcpServers(originalContent: string, servers: McpServer[], target: McpTarget): string {
    if (target === 'codex') return applyCodexServers(originalContent, servers);
    return applyJsonServers(originalContent, servers, target);
}

/** Drop undefined values and empty objects/arrays from an entry. */
function compact(entry: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
        if (v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
        out[k] = v;
    }
    return out;
}

function serverToJsonEntry(s: McpServer, target: McpTarget): Record<string, unknown> {
    const extras = s.extras ?? {};
    if (s.transport === 'stdio') {
        return compact({ command: s.command, args: s.args, env: s.env, ...extras });
    }
    if (target === 'gemini') {
        return s.transport === 'http'
            ? compact({ httpUrl: s.url, headers: s.headers, ...extras })
            : compact({ url: s.url, headers: s.headers, ...extras });
    }
    return compact({ type: s.transport, url: s.url, headers: s.headers, ...extras });
}

function applyJsonServers(originalContent: string, servers: McpServer[], target: McpTarget): string {
    const trimmed = originalContent.trim();
    const root = trimmed ? JSON.parse(trimmed) : {};
    const mcp: Record<string, unknown> = {};
    for (const s of servers) mcp[s.name] = serverToJsonEntry(s, target);
    root.mcpServers = mcp;
    return JSON.stringify(root, null, 2) + '\n';
}

function tomlString(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** A TOML key segment: bare if safe, otherwise a quoted string. */
function tomlKey(name: string): string {
    return /^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name);
}

function tomlArray(values: string[]): string {
    return '[' + values.map(tomlString).join(', ') + ']';
}

/** Emit a `[mcp_servers.<name>.<sub>]` table for a key/value map. */
function tomlSubTable(serverName: string, sub: string, map: Record<string, string>): string {
    const lines = [`[mcp_servers.${tomlKey(serverName)}.${sub}]`];
    for (const [k, v] of Object.entries(map)) lines.push(`${k} = ${tomlString(v)}`);
    return lines.join('\n');
}

function serverToCodexBlock(s: McpServer): string {
    const head = [`[mcp_servers.${tomlKey(s.name)}]`];
    const subTables: string[] = [];
    if (s.transport === 'stdio') {
        if (s.command) head.push(`command = ${tomlString(s.command)}`);
        if (s.args && s.args.length) head.push(`args = ${tomlArray(s.args)}`);
        if (s.env && Object.keys(s.env).length) subTables.push(tomlSubTable(s.name, 'env', s.env));
    } else {
        if (s.url) head.push(`url = ${tomlString(s.url)}`);
        if (s.headers && Object.keys(s.headers).length) {
            subTables.push(tomlSubTable(s.name, 'http_headers', s.headers));
        }
    }
    // Re-emit scalar extras (e.g. Codex's startup_timeout_ms) so editing one
    // server never drops another's keys. Non-scalar extras are not preserved.
    for (const [k, v] of Object.entries(s.extras ?? {})) {
        if (typeof v === 'string') head.push(`${k} = ${tomlString(v)}`);
        else if (typeof v === 'number' || typeof v === 'boolean') head.push(`${k} = ${String(v)}`);
    }
    return [head.join('\n'), ...subTables].join('\n\n');
}

/** True for a line that opens an `[mcp_servers...]` or `[[mcp_servers...]]` table. */
function isMcpServersHeader(line: string): boolean {
    const m = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (!m) return false;
    const name = m[1].trim();
    return name === 'mcp_servers' || name.startsWith('mcp_servers.');
}

function isAnyTableHeader(line: string): boolean {
    return /^\s*\[\[?\s*[^\]]+?\s*\]\]?\s*$/.test(line);
}

function applyCodexServers(originalContent: string, servers: McpServer[]): string {
    const lines = originalContent.split('\n');
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
        if (isAnyTableHeader(line)) {
            skipping = isMcpServersHeader(line);
        }
        if (!skipping) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    const blocks = servers.map(serverToCodexBlock);
    const body = kept.join('\n');
    const parts = [body, ...blocks].filter(p => p.length > 0);
    return parts.join('\n\n') + '\n';
}
