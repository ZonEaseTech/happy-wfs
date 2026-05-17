import { describe, expect, it } from 'vitest';
import { parseMcpServers } from './mcpConfig';

describe('parseMcpServers — JSON (claude)', () => {
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
        expect(parsed[0]).toMatchObject({ name: 'a', transport: 'http', url: 'https://h' });
        expect(parsed[1]).toMatchObject({ name: 'b', transport: 'sse', url: 'https://s' });
    });

    it('throws on malformed JSON', () => {
        expect(() => parseMcpServers('{bad', 'claude')).toThrow();
    });
});
