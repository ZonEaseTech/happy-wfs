import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '../../api/encryption';
import { registerCommonHandlers } from './registerCommonHandlers';
import { getToolOutputRecord, saveToolOutputRecord, type ToolOutputRecord } from './toolOutputStore';

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/happy-cli-test-home',
    },
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

const outputsDir = join(configuration.happyHomeDir, 'tool-outputs');
const testSessionId = 'test-session-tool-output-store';

function createRpcHandlerManager(): RpcHandlerManager {
    return new RpcHandlerManager({
        scopePrefix: 'session',
        encryptionKey: new Uint8Array(32).fill(7),
        encryptionVariant: 'legacy',
        logger: () => {},
    });
}

describe('toolOutputStore', () => {
    const filePath = join(outputsDir, `${testSessionId}.jsonl`);
    const legacyFilePath = join(outputsDir, `${testSessionId}.json`);

    function removeFiles() {
        for (const path of [filePath, legacyFilePath]) {
            if (existsSync(path)) rmSync(path);
        }
    }

    beforeEach(removeFiles);
    afterEach(removeFiles);

    it('saves and retrieves a record', async () => {
        const record: ToolOutputRecord = {
            callId: 'call-1',
            toolName: 'Read',
            agent: 'claude',
            result: { file: { content: 'hello world', filePath: '/a.ts' } },
            timestamp: Date.now(),
        };

        saveToolOutputRecord(testSessionId, record);
        const retrieved = await getToolOutputRecord(testSessionId, 'call-1');

        expect(retrieved).not.toBeNull();
        expect(retrieved!.callId).toBe('call-1');
        expect(retrieved!.toolName).toBe('Read');
        expect(retrieved!.agent).toBe('claude');
        expect((retrieved!.result as any).file.content).toBe('hello world');
    });

    it('returns null for missing record', async () => {
        expect(await getToolOutputRecord(testSessionId, 'missing-call')).toBeNull();
    });

    it('returns null for missing session', async () => {
        expect(await getToolOutputRecord('missing-session', 'call-1')).toBeNull();
    });

    it('appends one line per record instead of rewriting the file', async () => {
        saveToolOutputRecord(testSessionId, {
            callId: 'call-1',
            toolName: 'Read',
            agent: 'claude',
            result: { data: 'first' },
            timestamp: Date.now(),
        });
        saveToolOutputRecord(testSessionId, {
            callId: 'call-2',
            toolName: 'CodexBash',
            agent: 'codex',
            result: { stdout: 'second' },
            timestamp: Date.now(),
        });

        expect(await getToolOutputRecord(testSessionId, 'call-1')).not.toBeNull();
        expect(await getToolOutputRecord(testSessionId, 'call-2')).not.toBeNull();

        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        expect(lines.map((line) => JSON.parse(line).callId)).toEqual(['call-1', 'call-2']);
        expect(existsSync(legacyFilePath)).toBe(false);
    });

    it('still reads records that older versions wrote as a JSON array', async () => {
        mkdirSync(outputsDir, { recursive: true });
        writeFileSync(legacyFilePath, JSON.stringify([
            { callId: 'old-call', toolName: 'Read', agent: 'claude', result: { data: 'old' }, timestamp: 1 },
        ]));
        saveToolOutputRecord(testSessionId, {
            callId: 'new-call',
            toolName: 'Read',
            agent: 'claude',
            result: { data: 'new' },
            timestamp: 2,
        });

        expect((await getToolOutputRecord(testSessionId, 'old-call'))?.result).toEqual({ data: 'old' });
        expect((await getToolOutputRecord(testSessionId, 'new-call'))?.result).toEqual({ data: 'new' });
    });

    it('skips a line cut short by a crash mid-append', async () => {
        mkdirSync(outputsDir, { recursive: true });
        writeFileSync(filePath, '{"callId":"call-1","toolName":"Read","result":{"data":"cut\n');
        saveToolOutputRecord(testSessionId, {
            callId: 'call-1',
            toolName: 'Read',
            agent: 'claude',
            result: { data: 'whole' },
            timestamp: Date.now(),
        });

        expect((await getToolOutputRecord(testSessionId, 'call-1'))?.result).toEqual({ data: 'whole' });
    });

    it('keeps large records intact when saves overlap', async () => {
        const big = (fill: string) => fill.repeat(2 * 1024 * 1024);
        saveToolOutputRecord(testSessionId, {
            callId: 'call-a',
            toolName: 'CodexBash',
            agent: 'codex',
            result: { stdout: big('a') },
            timestamp: Date.now(),
        });
        saveToolOutputRecord(testSessionId, {
            callId: 'call-b',
            toolName: 'CodexBash',
            agent: 'codex',
            result: { stdout: big('b') },
            timestamp: Date.now(),
        });

        expect(((await getToolOutputRecord(testSessionId, 'call-b'))?.result as any).stdout).toBe(big('b'));

        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        expect(lines.map((line) => JSON.parse(line).result.stdout)).toEqual([big('a'), big('b')]);
    });
});

describe('getToolOutput rpc', () => {
    it('returns stored output for the current session scope', async () => {
        const manager = createRpcHandlerManager();
        registerCommonHandlers(manager, '/tmp', testSessionId);

        saveToolOutputRecord(testSessionId, {
            callId: 'call-1',
            toolName: 'GeminiBash',
            agent: 'gemini',
            result: { stdout: 'hello', stderr: '', exit_code: 0 },
            timestamp: Date.now(),
        });

        const params = encodeBase64(
            encrypt(new Uint8Array(32).fill(7), 'legacy', { callId: 'call-1' })
        );

        const response = await manager.handleRequest({
            method: 'session:getToolOutput',
            params,
        });

        const decoded = decrypt(
            new Uint8Array(32).fill(7),
            'legacy',
            decodeBase64(response)
        );

        expect(decoded).toEqual({
            success: true,
            toolName: 'GeminiBash',
            agent: 'gemini',
            result: { stdout: 'hello', stderr: '', exit_code: 0 },
        });
    });

    it('returns not_found when no record exists', async () => {
        const manager = createRpcHandlerManager();
        registerCommonHandlers(manager, '/tmp', testSessionId);

        const params = encodeBase64(
            encrypt(new Uint8Array(32).fill(7), 'legacy', { callId: 'missing-call' })
        );

        const response = await manager.handleRequest({
            method: 'session:getToolOutput',
            params,
        });

        const decoded = decrypt(
            new Uint8Array(32).fill(7),
            'legacy',
            decodeBase64(response)
        );

        expect(decoded).toEqual({
            success: false,
            error: 'not_found',
        });
    });
});
