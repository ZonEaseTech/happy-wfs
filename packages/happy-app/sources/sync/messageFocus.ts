export type MessageFocusState = { all: boolean; sessionIds: string[] };

/**
 * Which sessions this client shows messages for. With focused updates the
 * server sends full new-message updates only for these and a small hint for
 * every other session; message bodies of sessions nobody looks at were most of
 * what the web app downloaded. Counted per session so two views of one session
 * do not drop it when one closes; `all` while something (a voice conversation)
 * follows every session's messages. Changes within one tick go out as one
 * report, so moving from one session to another never reports an empty set.
 */
export function createMessageFocus(send: (state: MessageFocusState) => void) {
    const counts = new Map<string, number>();
    let allHolders = 0;
    let scheduled = false;

    const current = (): MessageFocusState => ({ all: allHolders > 0, sessionIds: [...counts.keys()] });
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            send(current());
        });
    };
    const once = (release: () => void) => {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            release();
            schedule();
        };
    };

    return {
        /** Show this session's messages until the returned function is called */
        focus(sessionId: string): () => void {
            counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
            schedule();
            return once(() => {
                const left = (counts.get(sessionId) ?? 1) - 1;
                if (left > 0) {
                    counts.set(sessionId, left);
                } else {
                    counts.delete(sessionId);
                }
            });
        },
        /** Follow every session's messages until the returned function is called */
        focusAll(): () => void {
            allHolders += 1;
            schedule();
            return once(() => {
                allHolders = Math.max(0, allHolders - 1);
            });
        },
        isFocused(sessionId: string): boolean {
            return allHolders > 0 || counts.has(sessionId);
        },
        /** Report again, e.g. to a new connection that knows nothing yet */
        resend() {
            send(current());
        },
    };
}
