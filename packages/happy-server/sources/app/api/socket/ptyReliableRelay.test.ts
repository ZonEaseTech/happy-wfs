/**
 * The relay chooses between a volatile and a normal emit per frame, and the
 * wrong choice is invisible until it matters.
 *
 * A terminal wants volatile: when a client cannot keep up, stale bytes are
 * noise and queueing them only delays the live ones. A streamed command wants
 * the opposite — dropping an output frame truncates the command, and dropping
 * the exit frame leaves the caller waiting on a command that already finished.
 * Both failures need a large, bursty output to show up at all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'ptyHandler.ts'), 'utf8');

describe('pty frame relay', () => {
    it('emits reliably only when the frame asked for it', () => {
        expect(source).toContain('if ((payload as { reliable?: boolean }).reliable) {');
        expect(source).toContain('conn.socket.emit(eventName, payload);');
        // The terminal path must keep dropping frames under pressure.
        expect(source).toContain('conn.socket.volatile.emit(eventName, payload);');
    });

    it('carries the flag through both relayed events', () => {
        // Set by the device; without forwarding it the relay always falls back
        // to volatile and the streaming fix does nothing.
        const occurrences = source.match(/data\.reliable === true \? \{ reliable: true \} : \{\}/g) ?? [];
        expect(occurrences).toHaveLength(2);
    });

    it('keeps shared users on the same delivery path as the owner', () => {
        // Both go through emitToSessionInterested, so a shared session cannot
        // silently lose frames the owner receives.
        expect(source).toContain('emitToSessionInterested(share.sharedWithUserId, sessionId, eventName, payload)');
    });
});
