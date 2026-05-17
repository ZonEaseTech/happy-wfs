import { describe, expect, it } from 'vitest';
import { applyMcpServers, parseMcpServers } from './mcpConfig';

describe('parseMcpServers — JSON codec', () => {
    it('returns [] when mcpServers is absent', () => {
        expect(parseMcpServers('{}', 'claude')).toEqual([]);
        expect(parseMcpServers('', 'claude')).toEqual([]);
    });

    it('parses a stdio server', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' } } } });
        expect(parseMcpServers(content, 'claude')).toEqual([
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' }, extras: undefined },
        ]);
    });

    it('parses an http server via type', () => {
        const content = JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
        expect(parseMcpServers(content, 'claude')).toEqual([
            { name: 'api', transport: 'http', url: 'https://x', headers: { A: 'b' }, extras: undefined },
        ]);
    });

    it('keeps unknown keys in extras', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'x', timeout: 30 } } });
        expect(parseMcpServers(content, 'claude')[0].extras).toEqual({ timeout: 30 });
    });

    it('reads gemini httpUrl as http and bare url as sse', () => {
        const content = JSON.stringify({ mcpServers: { a: { httpUrl: 'https://h' }, b: { url: 'https://s' } } });
        const parsed = parseMcpServers(content, 'gemini');
        expect(parsed[0]).toEqual({ name: 'a', transport: 'http', url: 'https://h', extras: undefined });
        expect(parsed[1]).toEqual({ name: 'b', transport: 'sse', url: 'https://s', extras: undefined });
    });

    it('throws on malformed JSON', () => {
        expect(() => parseMcpServers('{bad', 'claude')).toThrow();
    });
});

describe('applyMcpServers — JSON', () => {
    it('writes mcpServers and preserves other top-level keys', () => {
        const original = JSON.stringify({ permissions: { allow: ['x'] }, mcpServers: {} }, null, 2);
        const out = applyMcpServers(original, [
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y'], env: { K: 'V' } },
        ], 'claude');
        const parsed = JSON.parse(out);
        expect(parsed.permissions).toEqual({ allow: ['x'] });
        expect(parsed.mcpServers.fs).toEqual({ command: 'npx', args: ['-y'], env: { K: 'V' } });
    });

    it('round-trips a claude http server', () => {
        const content = JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
        const out = applyMcpServers(content, parseMcpServers(content, 'claude'), 'claude');
        expect(JSON.parse(out).mcpServers.api).toEqual({ type: 'http', url: 'https://x', headers: { A: 'b' } });
    });

    it('uses httpUrl for gemini http servers', () => {
        const out = applyMcpServers('', [{ name: 'a', transport: 'http', url: 'https://h' }], 'gemini');
        expect(JSON.parse(out).mcpServers.a).toEqual({ httpUrl: 'https://h' });
    });

    it('preserves extras on the server entry', () => {
        const content = JSON.stringify({ mcpServers: { fs: { command: 'x', timeout: 30 } } });
        const out = applyMcpServers(content, parseMcpServers(content, 'claude'), 'claude');
        expect(JSON.parse(out).mcpServers.fs).toEqual({ command: 'x', timeout: 30 });
    });

    it('builds valid output from empty content', () => {
        const out = applyMcpServers('', [{ name: 's', transport: 'stdio', command: 'c' }], 'claude');
        expect(JSON.parse(out)).toEqual({ mcpServers: { s: { command: 'c' } } });
    });
});

describe('parseMcpServers — TOML (codex)', () => {
    it('returns [] when there are no mcp_servers tables', () => {
        expect(parseMcpServers('model = "gpt-5"\n', 'codex')).toEqual([]);
        expect(parseMcpServers('', 'codex')).toEqual([]);
    });

    it('parses a stdio server table', () => {
        const toml = '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "pkg"]\n\n[mcp_servers.fs.env]\nK = "V"\n';
        expect(parseMcpServers(toml, 'codex')).toEqual([
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { K: 'V' }, extras: undefined },
        ]);
    });

    it('parses a url table as http', () => {
        const toml = '[mcp_servers.api]\nurl = "https://x"\n';
        expect(parseMcpServers(toml, 'codex')[0]).toMatchObject({ name: 'api', transport: 'http', url: 'https://x' });
    });

    it('throws on malformed TOML', () => {
        expect(() => parseMcpServers('[mcp_servers.', 'codex')).toThrow();
    });
});

describe('applyMcpServers — TOML (codex)', () => {
    it('preserves non-MCP settings and comments, replaces mcp_servers region', () => {
        const original = '# top comment\nmodel = "gpt-5"\n\n[mcp_servers.old]\ncommand = "x"\n';
        const out = applyMcpServers(original, [
            { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y'], env: { K: 'V' } },
        ], 'codex');
        expect(out).toContain('# top comment');
        expect(out).toContain('model = "gpt-5"');
        expect(out).not.toContain('[mcp_servers.old]');
        expect(out).toContain('[mcp_servers.fs]');
        expect(out).toContain('command = "npx"');
        expect(out).toContain('args = ["-y"]');
        expect(out).toContain('[mcp_servers.fs.env]');
        expect(out).toContain('K = "V"');
    });

    it('round-trips a stdio server', () => {
        const original = '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "pkg"]\n';
        const out = applyMcpServers(original, parseMcpServers(original, 'codex'), 'codex');
        expect(parseMcpServers(out, 'codex')).toEqual(parseMcpServers(original, 'codex'));
    });

    it('writes a url server', () => {
        const out = applyMcpServers('', [{ name: 'api', transport: 'http', url: 'https://x' }], 'codex');
        expect(out).toContain('[mcp_servers.api]');
        expect(out).toContain('url = "https://x"');
    });

    it('escapes quotes and backslashes in values', () => {
        const out = applyMcpServers('', [{ name: 's', transport: 'stdio', command: 'a"b\\c' }], 'codex');
        expect(out).toContain('command = "a\\"b\\\\c"');
    });

    it('preserves scalar extras on a server', () => {
        const original = '[mcp_servers.fs]\ncommand = "x"\nstartup_timeout_ms = 5000\n';
        const out = applyMcpServers(original, parseMcpServers(original, 'codex'), 'codex');
        expect(out).toContain('startup_timeout_ms = 5000');
    });
});
