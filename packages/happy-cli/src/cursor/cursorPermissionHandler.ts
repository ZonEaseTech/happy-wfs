/**
 * Cursor Permission Handler
 *
 * Same contract as the Codex and Gemini handlers: park the tool call, show it
 * on the phone, resolve when the user answers. The base class already handles
 * the pending map, the RPC reply channel and the push notification.
 *
 * The one Cursor-specific rule lives here: its `preToolUse` hook understands
 * only allow and deny. Returning "ask" there is silently treated as allow
 * (measured against cursor-agent 2026.08.11), so every decision this handler
 * produces has to collapse to one of those two.
 */

import { logger } from '@/ui/logger';
import { ApiSessionClient } from '@/api/apiSession';
import { PushNotificationClient } from '@/api/pushNotifications';
import {
    BasePermissionHandler,
    type PermissionResult,
    type PendingRequest,
} from '@/utils/BasePermissionHandler';

export type { PermissionResult, PendingRequest };

/** Tools that would deadlock or annoy if they needed a tap every time. */
const ALWAYS_ALLOWED_TOOLS = ['change_title', 'happy__change_title', 'preview_html', 'happy__preview_html'];

export class CursorPermissionHandler extends BasePermissionHandler {
    /** Set once the user answers "approve for session" or picks a yolo mode. */
    private approveEverything = false;

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[cursor]';
    }

    protected getAgentName(): string {
        return 'Cursor';
    }

    /** Skip the round trip for tools that are part of Happy's own plumbing. */
    private shouldAutoApprove(toolName: string): boolean {
        const lower = toolName.toLowerCase();
        return ALWAYS_ALLOWED_TOOLS.some(name => lower.includes(name.toLowerCase()));
    }

    /**
     * Blocks until the phone answers. The hook process on the other end is
     * happy to wait — Cursor imposes no deadline of its own beyond the
     * `timeout` we write into hooks.json.
     */
    async requestApproval(toolCallId: string, toolName: string, input: unknown): Promise<boolean> {
        if (this.approveEverything || this.shouldAutoApprove(toolName)) {
            logger.debug(`${this.getLogPrefix()} auto-approving ${toolName}`);
            return true;
        }

        const result = await new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
            logger.debug(`${this.getLogPrefix()} awaiting approval for ${toolName} (${toolCallId})`);
        });

        if (result.decision === 'approved_for_session') {
            // Remember it, otherwise every later call would ask again despite
            // the user having said "allow for this session".
            this.approveEverything = true;
        }
        return result.decision === 'approved' || result.decision === 'approved_for_session';
    }
}
