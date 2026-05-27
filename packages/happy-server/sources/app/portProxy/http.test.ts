import { describe, expect, it } from 'vitest';
import { createPortProxyBodySchema, updatePortProxyBodySchema } from './schemas';
import { filterProxyRequestHeaders, filterProxyResponseHeaders, fromBase64Body, toBase64Body } from './http';

function bytesToString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

describe('port proxy HTTP helpers', () => {
    it('filters hop-by-hop request headers plus host and content-length', () => {
        const filtered = filterProxyRequestHeaders({
            connection: 'keep-alive',
            host: 'example.test',
            upgrade: 'websocket',
            'transfer-encoding': 'chunked',
            'content-length': '123',
            'x-forward-me': ['one', 'two'],
            accept: 'application/json',
        });

        expect(filtered).toEqual({
            'x-forward-me': 'one, two',
            accept: 'application/json',
        });
    });

    it('filters request headers named by the connection header', () => {
        const filtered = filterProxyRequestHeaders({
            Connection: 'x-debug, x-internal',
            'X-Debug': 'debug',
            'x-internal': 'internal',
            accept: 'application/json',
        });

        expect(filtered).toEqual({ accept: 'application/json' });
    });

    it('filters hop-by-hop response headers plus host and content-length', () => {
        const filtered = filterProxyResponseHeaders({
            Connection: 'close',
            Host: 'example.test',
            Upgrade: 'websocket',
            Trailer: 'expires',
            'Transfer-Encoding': 'chunked',
            'Content-Length': '456',
            'Set-Cookie': ['a=1', 'b=2'],
            'Content-Type': 'text/plain',
        });

        expect(filtered).toEqual({
            'set-cookie': ['a=1', 'b=2'],
            'content-type': 'text/plain',
        });
    });

    it('filters response headers named by the connection header', () => {
        const filtered = filterProxyResponseHeaders({
            Connection: 'x-debug, x-internal',
            'X-Debug': 'debug',
            'x-internal': 'internal',
            'Content-Type': 'text/plain',
        });

        expect(filtered).toEqual({ 'content-type': 'text/plain' });
    });

    it('returns an empty string for missing bodies', () => {
        expect(toBase64Body(undefined)).toBe('');
    });

    it('round trips string bodies through base64', () => {
        expect(bytesToString(fromBase64Body(toBase64Body('hello')))).toBe('hello');
    });

    it('round trips Uint8Array bodies through base64', () => {
        const body = new Uint8Array([0, 1, 2, 255]);

        expect(Array.from(fromBase64Body(toBase64Body(body)))).toEqual(Array.from(body));
    });
});

describe('port proxy schemas', () => {
    it('trims create names and rejects blank or long names', () => {
        expect(createPortProxyBodySchema.parse({
            machineId: 'machine-1',
            name: '  dev server  ',
            localPort: 3000,
        }).name).toBe('dev server');
        expect(createPortProxyBodySchema.safeParse({
            machineId: 'machine-1',
            name: '   ',
            localPort: 3000,
        }).success).toBe(false);
        expect(createPortProxyBodySchema.safeParse({
            machineId: 'machine-1',
            name: 'x'.repeat(81),
            localPort: 3000,
        }).success).toBe(false);
    });

    it('trims update names and rejects blank or long names when present', () => {
        expect(updatePortProxyBodySchema.parse({ name: '  dev server  ' }).name).toBe('dev server');
        expect(updatePortProxyBodySchema.safeParse({ name: '   ' }).success).toBe(false);
        expect(updatePortProxyBodySchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    });
});
