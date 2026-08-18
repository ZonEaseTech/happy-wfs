/**
 * Samples below are verbatim lines from a real `cursor-agent -p ...
 * --output-format stream-json` run (cursor-agent 2026.08.11-e8db854,
 * model Composer 2.5), so the mapping stays pinned to observed output.
 */

import { describe, it, expect } from 'vitest';
import { createCursorStreamState, drainJsonLines, mapCursorStreamEvent, parseCursorSessionInit } from './cursorStreamEvents';

const INIT = '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp/cursor-hook-probe","session_id":"cef99571-cc75-4512-a73f-b953212d6493","model":"Composer 2.5","permissionMode":"default"}';
const THINKING_DELTA = '{"type":"thinking","subtype":"delta","text":"正在当前目录创建 hello.txt","session_id":"s1","timestamp_ms":1786956076436}';
const THINKING_DONE = '{"type":"thinking","subtype":"completed","session_id":"s1","timestamp_ms":1786956076442}';
const TOOL_STARTED = '{"type":"tool_call","subtype":"started","call_id":"tool_34e8","tool_call":{"editToolCall":{"args":{"path":"/tmp/x/hello.txt","streamContent":"hi\\n"}},"toolCallId":"tool_34e8"}}';
const TOOL_COMPLETED = '{"type":"tool_call","subtype":"completed","call_id":"tool_34e8","tool_call":{"editToolCall":{"args":{"path":"/tmp/x/hello.txt"},"result":{"success":{"path":"/tmp/x/hello.txt","linesAdded":1,"linesRemoved":0,"diffString":"--- /dev/null\\n+++ b//tmp/x/hello.txt\\n@@ -1,0 +1 @@\\n+hi"}}}}}';
const ASSISTANT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"已在当前目录创建 `hello.txt`"}]},"session_id":"s1"}';
const USER = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"创建 hello.txt"}]},"session_id":"s1"}';
const RESULT = '{"type":"result","subtype":"success","duration_ms":11444,"is_error":false,"result":"done","session_id":"s1","request_id":"r1","usage":{"inputTokens":4282,"outputTokens":113,"cacheReadTokens":22063,"cacheWriteTokens":0}}';

function mapLine(line: string) {
    const { events } = drainJsonLines(line + '\n');
    expect(events).toHaveLength(1);
    return mapCursorStreamEvent(events[0]);
}

describe('parseCursorSessionInit', () => {
    it('extracts the chat id and model from system/init', () => {
        const { events } = drainJsonLines(INIT + '\n');
        expect(parseCursorSessionInit(events[0])).toEqual({
            sessionId: 'cef99571-cc75-4512-a73f-b953212d6493',
            model: 'Composer 2.5',
            cwd: '/tmp/cursor-hook-probe',
            permissionMode: 'default',
            apiKeySource: 'login',
        });
    });

    it('ignores events that are not system/init', () => {
        const { events } = drainJsonLines(ASSISTANT + '\n');
        expect(parseCursorSessionInit(events[0])).toBeNull();
    });
});

describe('mapCursorStreamEvent', () => {
    it('reports the session as running once init arrives', () => {
        expect(mapLine(INIT)).toEqual([
            { type: 'status', status: 'running', detail: 'cursor-agent ready (Composer 2.5)' },
        ]);
    });

    it('drops the echoed user turn so the app does not double it', () => {
        expect(mapLine(USER)).toEqual([]);
    });

    it('forwards thinking deltas and ignores the completion marker', () => {
        expect(mapLine(THINKING_DELTA)).toEqual([
            { type: 'event', name: 'thinking', payload: { textDelta: '正在当前目录创建 hello.txt' } },
        ]);
        expect(mapLine(THINKING_DONE)).toEqual([]);
    });

    it('maps assistant content to model output', () => {
        expect(mapLine(ASSISTANT)).toEqual([
            { type: 'model-output', fullText: '已在当前目录创建 `hello.txt`' },
        ]);
    });

    it('names the tool from the wrapper key on a started call', () => {
        expect(mapLine(TOOL_STARTED)).toEqual([
            {
                type: 'tool-call',
                toolName: 'Edit',
                // path/streamContent are Cursor's spellings; file_path/content
                // are what the app's Edit card reads.
                args: {
                    path: '/tmp/x/hello.txt',
                    file_path: '/tmp/x/hello.txt',
                    streamContent: 'hi\n',
                    content: 'hi\n',
                },
                callId: 'tool_34e8',
            },
        ]);
    });

    it('emits both a tool result and an fs-edit when a completed edit carries a diff', () => {
        const messages = mapLine(TOOL_COMPLETED);
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({ type: 'tool-result', toolName: 'Edit', callId: 'tool_34e8' });
        expect(messages[1]).toEqual({
            type: 'fs-edit',
            description: 'Edited /tmp/x/hello.txt',
            diff: '--- /dev/null\n+++ b//tmp/x/hello.txt\n@@ -1,0 +1 @@\n+hi',
            path: '/tmp/x/hello.txt',
        });
    });

    it('turns the result event into usage plus an idle status', () => {
        expect(mapLine(RESULT)).toEqual([
            { type: 'token-count', inputTokens: 4282, outputTokens: 113, cacheReadTokens: 22063, cacheWriteTokens: 0 },
            { type: 'status', status: 'idle', detail: 'success' },
        ]);
    });

    it('marks an errored result as error status', () => {
        const errored = RESULT.replace('"is_error":false', '"is_error":true').replace('"subtype":"success"', '"subtype":"error_during_execution"');
        const messages = mapLine(errored);
        expect(messages[messages.length - 1]).toEqual({
            type: 'status',
            status: 'error',
            detail: 'error_during_execution',
        });
    });

    it('ignores event types it does not know', () => {
        expect(mapLine('{"type":"something_new","payload":1}')).toEqual([]);
    });
});

describe('drainJsonLines', () => {
    it('holds back a line split across chunks until it completes', () => {
        const half = INIT.slice(0, 40);
        const first = drainJsonLines(half);
        expect(first.events).toEqual([]);
        expect(first.rest).toBe(half);

        const second = drainJsonLines(first.rest + INIT.slice(40) + '\n');
        expect(second.events).toHaveLength(1);
        expect(second.rest).toBe('');
    });

    it('skips blank lines and non-JSON noise without failing', () => {
        const { events } = drainJsonLines(`\nwarning: something\n${ASSISTANT}\n`);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('assistant');
    });

    it('parses several events out of one chunk', () => {
        const { events, rest } = drainJsonLines([INIT, THINKING_DELTA, ASSISTANT].join('\n') + '\n');
        expect(events.map(e => e.type)).toEqual(['system', 'thinking', 'assistant']);
        expect(rest).toBe('');
    });
});

describe('tool normalisation', () => {
    it('renames Cursor tools to the ones the app renders', () => {
        const read = mapLine('{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/a.txt"}}}}');
        expect(read[0]).toMatchObject({ type: 'tool-call', toolName: 'Read' });
        // The app's Read card reads file_path; Cursor only sends path.
        expect((read[0] as { args: Record<string, unknown> }).args).toMatchObject({
            path: '/tmp/a.txt',
            file_path: '/tmp/a.txt',
        });
    });

    it('maps shell to Bash and keeps its directory under both names', () => {
        const shell = mapLine('{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"shellToolCall":{"args":{"command":"ls","workingDirectory":"/tmp"}}}}');
        expect(shell[0]).toMatchObject({ type: 'tool-call', toolName: 'Bash' });
        expect((shell[0] as { args: Record<string, unknown> }).args).toMatchObject({
            command: 'ls',
            workingDirectory: '/tmp',
            cwd: '/tmp',
        });
    });

    it('keeps grep searchable by pattern', () => {
        const grep = mapLine('{"type":"tool_call","subtype":"started","call_id":"c3","tool_call":{"grepToolCall":{"args":{"pattern":"needle","path":"/tmp/sub"}}}}');
        expect(grep[0]).toMatchObject({ type: 'tool-call', toolName: 'Grep' });
        expect((grep[0] as { args: Record<string, unknown> }).args).toMatchObject({ pattern: 'needle', path: '/tmp/sub' });
    });

    it('capitalises an unknown tool rather than inventing a name', () => {
        const other = mapLine('{"type":"tool_call","subtype":"started","call_id":"c4","tool_call":{"somethingNewToolCall":{"args":{}}}}');
        expect(other[0]).toMatchObject({ toolName: 'SomethingNew' });
    });
});

describe('thinking accumulation', () => {
    it('joins the deltas and sends one thought when it completes', () => {
        const state = createCursorStreamState();
        const feed = (line: string) => {
            const { events } = drainJsonLines(line + '\n');
            return mapCursorStreamEvent(events[0], state);
        };

        // Cursor streams reasoning a few words at a time; each delta on its own
        // would render as a separate block in the app.
        expect(feed('{"type":"thinking","subtype":"delta","text":"先看目录，"}')).toEqual([]);
        expect(feed('{"type":"thinking","subtype":"delta","text":"再写文件。"}')).toEqual([]);
        expect(feed('{"type":"thinking","subtype":"completed"}')).toEqual([
            { type: 'event', name: 'thinking', payload: { textDelta: '先看目录，再写文件。' } },
        ]);
    });

    it('starts empty for the next thought', () => {
        const state = createCursorStreamState();
        const feed = (line: string) => {
            const { events } = drainJsonLines(line + '\n');
            return mapCursorStreamEvent(events[0], state);
        };
        feed('{"type":"thinking","subtype":"delta","text":"one"}');
        feed('{"type":"thinking","subtype":"completed"}');
        // A completion with nothing buffered must not re-emit the last thought.
        expect(feed('{"type":"thinking","subtype":"completed"}')).toEqual([]);
    });

    it('still forwards a delta when no state is supplied', () => {
        const { events } = drainJsonLines('{"type":"thinking","subtype":"delta","text":"solo"}\n');
        expect(mapCursorStreamEvent(events[0])).toEqual([
            { type: 'event', name: 'thinking', payload: { textDelta: 'solo' } },
        ]);
    });
});
