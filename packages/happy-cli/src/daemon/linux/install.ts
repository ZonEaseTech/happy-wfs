import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { logger } from '@/ui/logger';
import { trimIdent } from '@/utils/trimIdent';
import { projectPath } from '@/projectPath';
import { SERVICE_NAME, isRootUser, systemdScopeFor } from './systemdScope';

/** Service units start with an empty environment, so a self-hosted server URL
 *  or custom home dir must be baked in — otherwise the daemon silently falls
 *  back to defaults after a reboot and never reconnects. */
function environmentLines(): string {
    // Type=simple + the default KillMode reaps the whole cgroup when the main
    // process exits, so a successor this daemon spawns for itself never
    // survives. The flag tells it to exit non-zero and let Restart= re-exec
    // the new code instead.
    const lines: string[] = ['Environment=HAPPY_DAEMON_SUPERVISED=1'];
    if (process.env.HAPPY_SERVER_URL) lines.push(`Environment=HAPPY_SERVER_URL=${process.env.HAPPY_SERVER_URL}`);
    if (process.env.HAPPY_HOME_DIR) lines.push(`Environment=HAPPY_HOME_DIR=${process.env.HAPPY_HOME_DIR}`);
    if (process.env.HAPPY_WEBAPP_URL) lines.push(`Environment=HAPPY_WEBAPP_URL=${process.env.HAPPY_WEBAPP_URL}`);
    return lines.length ? '\n        ' + lines.join('\n        ') : '';
}

export async function install(): Promise<void> {
    const daemonEnvironmentLines = environmentLines();
    const runtime = process.execPath;
    const entrypoint = path.join(projectPath(), 'dist', 'index.mjs');

    if (!existsSync(entrypoint)) {
        throw new Error(`Entrypoint not found: ${entrypoint}. Please build the project first.`);
    }

    const homedir = os.homedir();
    const scope = systemdScopeFor(isRootUser());
    const servicePath = scope.unitPath;

    const serviceContent = trimIdent(`
        [Unit]
        Description=Happy AI CLI Daemon
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=simple
        ExecStart=${runtime} --no-warnings --no-deprecation ${entrypoint} daemon start-sync
        Restart=on-failure
        RestartSec=30
        Environment=HOME=${homedir}${daemonEnvironmentLines}

        [Install]
        WantedBy=${scope.wantedBy}
    `);

    mkdirSync(path.dirname(servicePath), { recursive: true });
    writeFileSync(servicePath, serviceContent + '\n');

    logger.info(`Created systemd ${scope.system ? 'system' : 'user'} service at ${servicePath}`);

    try {
        execSync(`systemctl ${scope.systemctlFlag} daemon-reload`.trim(), { stdio: 'pipe' });
        execSync(`systemctl ${scope.systemctlFlag} enable --now ${SERVICE_NAME}`.trim(), { stdio: 'pipe' });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
            scope.system
                ? `Failed to enable the systemd service: ${detail}`
                : `Failed to enable the systemd user service: ${detail}\n`
                + 'A user service needs a systemd user session (systemctl --user status must work).\n'
                + 'On a server, install it as root instead so it runs without a logged-in session: sudo happy daemon install',
        );
    }

    if (!scope.system) {
        // Without lingering a user service is stopped when the session ends, so
        // the machine would drop off Happy the moment you log out.
        try {
            execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'pipe' });
        } catch {
            logger.info('Could not enable lingering — the daemon may stop when you log out. Fix with: sudo loginctl enable-linger $USER');
        }
    }

    logger.info(scope.system
        ? 'Daemon enabled and started. It will auto-start on boot.'
        : 'Daemon enabled and started. It will auto-start on login.');
    logger.info('To disable: happy daemon disable');
}
