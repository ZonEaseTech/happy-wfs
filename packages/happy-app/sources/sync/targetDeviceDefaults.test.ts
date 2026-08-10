/**
 * Two rules carry this feature, and both fail quietly.
 *
 * `targetDevices` is tri-state: absent means never configured and gets filled
 * with every reachable device, an empty array means the user deliberately kept
 * the session on its own machine. Collapse those two and the picker's "this
 * session's machine" choice is silently undone on the next render.
 *
 * The prompt then has to say different things for one device and for many.
 * Targeting one is a redirect — "this machine" becomes that device. Targeting
 * all of them is just reach, and reusing the redirect wording would make every
 * new session answer questions about whichever device happened to sort first.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), 'utf8');

describe('target device defaults', () => {
    it('only fills in devices when the session has never been configured', () => {
        const view = read('../-session/SessionView.tsx');
        // != null, not a falsy check: [] is a deliberate choice and must stay.
        expect(view).toContain('metadata.targetDevices != null) return;');
    });

    it('saves an explicit empty selection rather than clearing the field', () => {
        const view = read('../-session/SessionView.tsx');
        expect(view).toContain('targetDevices: devices,');
        expect(view).not.toContain('targetDevices: devices.length > 0 ? devices : null');
    });

    it('tells the agent it is redirected only when a single device is targeted', () => {
        const source = read('./sync.ts');
        const single = source.indexOf('# Target device\n');
        const many = source.indexOf('# Reachable devices');
        expect(single).toBeGreaterThan(-1);
        expect(many).toBeGreaterThan(-1);

        const singleBlock = source.slice(single, many);
        expect(singleBlock).toContain('read "this machine" / "the current machine" as that device');

        const manyBlock = source.slice(many, many + 800);
        expect(manyBlock).toContain('"This machine" still means the session\'s own machine');
        expect(manyBlock).not.toContain('read "this machine" / "the current machine" as that device');
    });
});
