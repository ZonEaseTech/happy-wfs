import { existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger } from '@/ui/logger';
import { SERVICE_NAME, isRootUser, systemdScopeFor } from './systemdScope';

export async function uninstall(): Promise<void> {
    // Check both scopes: a machine may carry a user unit written by an older
    // CLI even though it now runs as root, and leaving either behind would let
    // systemd restart a daemon the user just disabled.
    const scopes = [systemdScopeFor(true), systemdScopeFor(false)].filter((scope) => existsSync(scope.unitPath));
    if (scopes.length === 0) {
        logger.info('No systemd service found. Auto-start is not enabled.');
        return;
    }

    for (const scope of scopes) {
        if (scope.system && !isRootUser()) {
            logger.info(`Skipping ${scope.unitPath} — removing it needs root: sudo happy daemon disable`);
            continue;
        }
        try {
            execSync(`systemctl ${scope.systemctlFlag} disable --now ${SERVICE_NAME}`.trim(), { stdio: 'ignore' });
        } catch {
            // May not be running, or the manager may be unavailable — the unit
            // file still has to go.
        }
        unlinkSync(scope.unitPath);
        try {
            execSync(`systemctl ${scope.systemctlFlag} daemon-reload`.trim(), { stdio: 'ignore' });
        } catch {
            // systemd user session may not be available (e.g. container)
        }
        logger.info(`Removed ${scope.unitPath}`);
    }

    logger.info('Daemon auto-start disabled.');
}
