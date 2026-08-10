/**
 * Root has to get a system unit. A user unit needs a systemd user instance and
 * a session bus that root over SSH usually does not have, and even where it
 * installs cleanly it stops at logout — a server enrolled that way silently
 * drops off Happy, which is what happened on kvm-wfs01.
 */

import { describe, expect, it } from 'vitest';
import { systemdScopeFor } from './systemdScope';

describe('systemdScopeFor', () => {
    it('gives root a boot-time system unit', () => {
        const scope = systemdScopeFor(true);
        expect(scope.system).toBe(true);
        expect(scope.unitPath).toBe('/etc/systemd/system/happy-daemon.service');
        expect(scope.systemctlFlag).toBe('');
        expect(scope.wantedBy).toBe('multi-user.target');
    });

    it('keeps a regular user on their own session unit', () => {
        const scope = systemdScopeFor(false);
        expect(scope.system).toBe(false);
        expect(scope.unitPath).toMatch(/\.config\/systemd\/user\/happy-daemon\.service$/);
        expect(scope.systemctlFlag).toBe('--user');
        // default.target only exists inside a user session.
        expect(scope.wantedBy).toBe('default.target');
    });
});
