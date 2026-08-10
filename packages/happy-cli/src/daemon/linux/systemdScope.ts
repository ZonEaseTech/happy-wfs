/**
 * Which systemd manager owns the daemon unit.
 *
 * A user unit needs a per-user systemd instance and a session bus, and root
 * over SSH usually has neither — `systemctl --user` then fails with "Failed to
 * connect to bus". Even where it works, a user unit stops when the session ends
 * unless lingering is enabled, which is the wrong shape for a server that has
 * to stay reachable. So root installs a system unit, which is also what an
 * unattended production box wants.
 */

import { join } from 'node:path';
import os from 'node:os';

export const SERVICE_NAME = 'happy-daemon.service';

export interface SystemdScope {
    /** true when the unit belongs to the system manager rather than a user one. */
    system: boolean;
    unitPath: string;
    /** Inserted into systemctl invocations; empty for the system manager. */
    systemctlFlag: string;
    /** default.target is only reachable inside a user session. */
    wantedBy: string;
}

export function systemdScopeFor(isRoot: boolean): SystemdScope {
    if (isRoot) {
        return {
            system: true,
            unitPath: join('/etc/systemd/system', SERVICE_NAME),
            systemctlFlag: '',
            wantedBy: 'multi-user.target',
        };
    }
    return {
        system: false,
        unitPath: join(os.homedir(), '.config', 'systemd', 'user', SERVICE_NAME),
        systemctlFlag: '--user',
        wantedBy: 'default.target',
    };
}

export function isRootUser(): boolean {
    return typeof process.getuid === 'function' && process.getuid() === 0;
}
