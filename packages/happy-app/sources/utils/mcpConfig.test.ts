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
