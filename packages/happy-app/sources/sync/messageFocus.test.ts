import { describe, expect, it, vi } from 'vitest';
import { createMessageFocus, type MessageFocusState } from './messageFocus';

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function setup() {
    const sent: MessageFocusState[] = [];
    const focus = createMessageFocus((state) => sent.push(state));
    return { focus, sent };
}

describe('messageFocus', () => {
    it('reports the sessions on screen', async () => {
        const { focus, sent } = setup();
        focus.focus('a');
        await flush();
        expect(sent.at(-1)).toEqual({ all: false, sessionIds: ['a'] });
    });

    it('moves from one session to another in a single report', async () => {
        const { focus, sent } = setup();
        const leaveA = focus.focus('a');
        await flush();
        leaveA();
        focus.focus('b');
        await flush();
        expect(sent).toEqual([
            { all: false, sessionIds: ['a'] },
            { all: false, sessionIds: ['b'] },
        ]);
    });

    it('keeps a session shown in two places until both close', async () => {
        const { focus, sent } = setup();
        const first = focus.focus('a');
        const second = focus.focus('a');
        first();
        await flush();
        expect(sent.at(-1)?.sessionIds).toEqual(['a']);
        second();
        await flush();
        expect(sent.at(-1)?.sessionIds).toEqual([]);
    });

    it('ignores a second release of the same view', async () => {
        const { focus, sent } = setup();
        const other = focus.focus('a');
        const view = focus.focus('a');
        view();
        view();
        await flush();
        expect(sent.at(-1)?.sessionIds).toEqual(['a']);
        other();
    });

    it('follows every session while something asks for all', async () => {
        const { focus, sent } = setup();
        const stop = focus.focusAll();
        await flush();
        expect(sent.at(-1)?.all).toBe(true);
        stop();
        await flush();
        expect(sent.at(-1)?.all).toBe(false);
    });

    it('reports the current state again on demand', () => {
        const send = vi.fn();
        const focus = createMessageFocus(send);
        focus.resend();
        expect(send).toHaveBeenCalledWith({ all: false, sessionIds: [] });
    });
});
