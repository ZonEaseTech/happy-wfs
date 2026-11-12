import { VAULT_MIN_CLI_VERSION, type VaultKey } from 'happy-wire';
import { isVersionSupported } from '@/utils/versionUtils';

const NEED_KEY = 'When a task needs an account or a server login that no listed key covers, run `happy keys need <type>` (type: cloudflare, aliyun, github, npm, ssh or custom) and stop to wait: the user gets a button in Happy to add the key and will tell you to continue. Never ask the user to paste a secret into the chat.';
const KEY_FILES = 'Never read ~/.happy/access.key, ~/.happy/device-keys.json or any other Happy key file, and never try to print or copy a credential.';

/**
 * The "# Credentials" block appended to the system prompt: which resource
 * center keys the session's machine can use and how. Never contains a secret.
 *
 * Must be deterministic (sorted, no timestamps): the CLI hashes the appended
 * prompt and restarts the agent whenever it changes.
 */
export function buildVaultPromptSection(keys: VaultKey[], machineId: string | undefined, cliVersion: string | undefined): string | null {
    if (!machineId || !isVersionSupported(cliVersion, VAULT_MIN_CLI_VERSION)) return null;
    const usable = keys
        .filter((key) => (key.ssh ? key.ssh.viaMachineId === machineId : key.machineIds.includes(machineId)))
        .sort((a, b) => a.slug.localeCompare(b.slug));
    if (usable.length === 0) {
        return [
            '# Credentials',
            '',
            'The user keeps credentials (cloud accounts, server logins) in Happy\'s resource center, but none are enabled for this machine yet.'
            + ` ${NEED_KEY}`
            + ` ${KEY_FILES}`,
        ].join('\n');
    }

    const lines = usable.map((key) => {
        const parts = [
            `- \`${key.slug}\` (${key.name}${key.ssh ? `, login ${key.ssh.user}@${key.ssh.host}` : ''})`,
            `allow: ${key.allow.map((rule) => `\`${rule}\``).join(', ') || 'nothing yet'}`,
            key.deny.length ? `deny: ${key.deny.map((rule) => `\`${rule}\``).join(', ')}` : null,
            ...key.scope.map((scope) => `covers ${scope.name}${scope.protected ? ` (do not touch: ${scope.protected})` : ''}`),
        ].filter(Boolean);
        return parts.join('; ');
    });

    return [
        '# Credentials',
        '',
        'The user keeps credentials in Happy\'s resource center. To use one, prefix the command with `happy run <name> --`, e.g. `happy run '
        + `${usable[0].slug} -- ${usable[0].ssh ? 'uptime' : (usable[0].allow.find((rule) => rule !== '*')?.replace(/\*/g, '').trim() || 'command')}\`.`
        + ' The secret is injected into that one command and masked in its output; you never see it.'
        + ' Only commands matching a key\'s allow rules run, deny rules always win, and commands that read the secret ($VAR, env, printenv, sh -c, eval) never run.'
        + ' If a command is refused for not being allowed, stop and wait: the user can allow it from this session in one tap and will ask you to run it again. Never work around a refusal.'
        + ` ${NEED_KEY}`
        + ` ${KEY_FILES}`
        + ' `happy keys` lists the details.',
        '',
        ...lines,
    ].join('\n');
}
