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
import type { PermissionMode } from '@/api/types';
import {
    BasePermissionHandler,
    type PermissionResult,
    type PendingRequest,
} from '@/utils/BasePermissionHandler';

export type { PermissionResult, PendingRequest };

/** Tools that would deadlock or annoy if they needed a tap every time. */
const ALWAYS_ALLOWED_TOOLS = ['change_title', 'happy__change_title', 'preview_html', 'happy__preview_html', 'list_bugs', 'happy__list_bugs', 'get_bug', 'happy__get_bug'];

/** Modes in which the user has said they do not want to be asked at all. */
const UNATTENDED_MODES: readonly string[] = ['yolo', 'safe-yolo', 'bypassPermissions'];

export class CursorPermissionHandler extends BasePermissionHandler {
    /** Set by "allow all tools for this session", or by an unattended mode. */
    private approveEverything = false;
    /** Tools the user answered "don't ask again" for. */
    private readonly allowedTools = new Set<string>();
    private currentPermissionMode: PermissionMode | null = null;

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[cursor]';
    }

    protected getAgentName(): string {
        return 'Cursor';
    }

    /**
     * The app sends the mode with each message. In an unattended mode asking
     * would contradict what the session badge promises, so tools just run.
     */
    setPermissionMode(mode: PermissionMode | null): void {
        if (mode === this.currentPermissionMode) return;
        this.currentPermissionMode = mode;
        logger.debug(`${this.getLogPrefix()} permission mode is now ${mode ?? 'default'}`);
    }

    private isUnattended(): boolean {
        return this.currentPermissionMode !== null && UNATTENDED_MODES.includes(this.currentPermissionMode);
    }

    private shouldAutoApprove(toolName: string): boolean {
        if (this.approveEverything || this.isUnattended()) return true;
        if (this.allowedTools.has(toolName)) return true;
        const lower = toolName.toLowerCase();
        return ALWAYS_ALLOWED_TOOLS.some(name => lower.includes(name.toLowerCase()));
    }

    /**
     * Blocks until the phone answers. The hook process on the other end is
     * happy to wait — Cursor imposes no deadline of its own beyond the
     * `timeout` we write into hooks.json.
     */
    async requestApproval(toolCallId: string, toolName: string, input: unknown): Promise<boolean> {
        if (this.shouldAutoApprove(toolName)) {
            logger.debug(`${this.getLogPrefix()} auto-approving ${toolName}`);
            return true;
        }

        const result = await new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
            logger.debug(`${this.getLogPrefix()} awaiting approval for ${toolName} (${toolCallId})`);
        });

        // "Don't ask about this tool again" — without this the same answer
        // would be demanded on every call.
        for (const allowed of result.allowTools ?? []) {
            this.allowedTools.add(allowed);
        }
        if (result.decision === 'approved_for_session' || (result.mode && UNATTENDED_MODES.includes(result.mode))) {
            this.approveEverything = true;
        }

        return result.decision === 'approved' || result.decision === 'approved_for_session';
    }
}
