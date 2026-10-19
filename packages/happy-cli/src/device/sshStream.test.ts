/**
 * `happy ssh --stream` learns which run is its own from the pty-start answer,
 * but the server relays output and exit frames as they come while the answer
 * takes the RPC path — a command that finishes in milliseconds can have both
 * frames arrive first. Dropping them left the caller waiting out the whole
 * timeout for a command that was long done.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64, encrypt, getRandomBytes } from '@/api/encryption';
import { runOnDevice } from './ssh';

const { mockIo, key } = vi.hoisted(() => ({ mockIo: vi.fn(), key: { current: new Uint8Array() as Uint8Array } }));

vi.mock('socket.io-client', () => ({ io: mockIo }));
vi.mock('@/daemon/controlClient', () => ({ execOnDeviceViaDaemon: vi.fn() }));
vi.mock('./deviceExec', () => ({ deviceExec: vi.fn(), listDevices: vi.fn() }));
vi.mock('./deviceKeys', () => ({
    readCachedDeviceNames: async () => ({ 'device-1': 'mac pro' }),
    readCachedDeviceKey: async () => ({ key: key.current, variant: 'legacy' }),
    ensureDeviceKey: vi.fn(),
    pruneDeviceAliases: vi.fn(),
}));

type Emit = (event: string, envelope: unknown) => void;

/** A socket whose pty-start answer is produced by `answer`, which may emit
 *  frames before or after it returns — the ordering under test. */
function fakeSocket(answer: (emit: Emit) => Promise<unknown>) {
    const handlers = new Map<string, Array<(arg: unknown) => void>>();
    const emit: Emit = (event, envelope) => handlers.get(event)?.forEach((handler) => handler(envelope));
    const socket = {
        on: (event: string, handler: (arg: unknown) => void) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return socket;
        },
        once: (event: string, handler: () => void) => {
            if (event === 'connect') queueMicrotask(handler);
            return socket;
        },
        timeout: () => ({ emitWithAck: async (_event: string, payload: { method: string }) => {
            expect(payload.method).toBe('device-1:pty-start');
            return await answer(emit);
        } }),
        close: () => emit('disconnect', undefined),
    };
    return socket;
}

const started = (ptyId: string) => ({ ok: true, result: encodeBase64(encrypt(key.current, 'legacy', { ok: true, ptyId })) });
const output = (ptyId: string, text: string, sessionId = 'device-1') => ({
    sessionId,
    ptyId,
    data: encodeBase64(encrypt(key.current, 'legacy', { stream: 'stdout', chunk: Buffer.from(text).toString('base64') })),
});

describe('runOnDevice --stream', () => {
    let written: string[];

    beforeEach(() => {
        key.current = getRandomBytes(32);
        written = [];
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
            written.push(Buffer.from(chunk).toString());
            return true;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps output and exit frames that arrive before the pty-start answer', async () => {
        mockIo.mockReturnValue(fakeSocket(async (emit) => {
            emit('pty-output', output('run-1', 'hi\n'));
            emit('pty-exit', { sessionId: 'device-1', ptyId: 'run-1', exitCode: 7 });
            return started('run-1');
        }));

        const exitCode = await runOnDevice({ token: 'token' } as any, 'mac pro', 'echo hi', { stream: true, timeoutMs: 1000 });

        expect(exitCode).toBe(7);
        expect(written.join('')).toBe('hi\n');
    });

    it('ignores early frames that belong to another run or another device', async () => {
        mockIo.mockReturnValue(fakeSocket(async (emit) => {
            emit('pty-output', output('someone-else', 'not mine\n'));
            emit('pty-output', output('run-1', 'other device\n', 'device-2'));
            emit('pty-exit', { sessionId: 'device-1', ptyId: 'someone-else', exitCode: 3 });
            emit('pty-output', output('run-1', 'mine\n'));
            setTimeout(() => emit('pty-exit', { sessionId: 'device-1', ptyId: 'run-1', exitCode: 0 }), 0);
            return started('run-1');
        }));

        const exitCode = await runOnDevice({ token: 'token' } as any, 'mac pro', 'echo mine', { stream: true, timeoutMs: 1000 });

        expect(exitCode).toBe(0);
        expect(written.join('')).toBe('mine\n');
    });

    it('still streams frames that arrive after the answer', async () => {
        mockIo.mockReturnValue(fakeSocket(async (emit) => {
            setTimeout(() => {
                emit('pty-output', output('run-1', 'later\n'));
                emit('pty-exit', { sessionId: 'device-1', ptyId: 'run-1', exitCode: 0 });
            }, 0);
            return started('run-1');
        }));

        const exitCode = await runOnDevice({ token: 'token' } as any, 'mac pro', 'echo later', { stream: true, timeoutMs: 1000 });

        expect(exitCode).toBe(0);
        expect(written.join('')).toBe('later\n');
    });
});
