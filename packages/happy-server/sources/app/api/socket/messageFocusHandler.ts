import { Socket } from "socket.io";
import { MessageFocus } from "@/app/events/eventRouter";

// More than any screen shows at once; bounds what a client can make us hold
const MAX_FOCUSED_SESSIONS = 50;

/**
 * A focused client (handshake focusedUpdates) reports which sessions it shows,
 * replacing the previous set each time; `all` asks for every session's
 * messages again, e.g. while a voice conversation follows them in the
 * background. Until the first report it gets hints for every session.
 */
export function messageFocusHandler(socket: Socket, focus: MessageFocus) {
    socket.on('message-focus', (data: unknown) => {
        if (!data || typeof data !== 'object') {
            return;
        }
        const { all, sessionIds } = data as { all?: unknown; sessionIds?: unknown };
        focus.all = all === true;
        focus.sessionIds = new Set(
            Array.isArray(sessionIds)
                ? sessionIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_FOCUSED_SESSIONS)
                : []
        );
    });
}
