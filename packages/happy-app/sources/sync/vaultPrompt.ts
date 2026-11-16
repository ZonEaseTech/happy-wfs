import { VAULT_GOOGLE_KEY_VAR, VAULT_MIN_CLI_VERSION, VAULT_TOOLS_MIN_CLI_VERSION, parseGoogleServiceAccount, vaultKeyDevices, vaultKindMinCliVersion, type VaultKey } from 'happy-wire';
import { isVersionSupported } from '@/utils/versionUtils';

const NEED_KEY = 'When a task needs an account or a server login that no listed key covers, run `happy keys need <type>` (type: cloudflare, aliyun, github, npm, ssh, email, google or custom) and stop to wait: the user gets a button in Happy to add the key and will tell you to continue. Never ask the user to paste a secret into the chat.';
/** CLIs with `save_key` / `delete_key` (VAULT_TOOLS_MIN_CLI_VERSION): the agent drafts keys itself, the user confirms on a card. */
const EDIT_KEYS = 'To add a key, change one (its allowed commands, devices, variables or secret) or delete one, call `save_key` or `delete_key`: Happy shows the user a card, nothing changes until they confirm it there, and they will tell you when it is done.'
    + ' When a task needs an account or a server login that no listed key covers, draft the key with `save_key`.'
    + ' Put a secret in only if the user already gave it to you in this conversation; otherwise leave it out and they fill it in on the card. Never ask the user to paste a secret into the chat.';
const KEY_FILES = 'Never read ~/.happy/access.key, ~/.happy/device-keys.json or any other Happy key file, and never try to print or copy a credential.';

/** The service account and default property of a Google key; its email is not a secret, the JSON around it is. */
function googleAccount(key: VaultKey): string {
    const account = parseGoogleServiceAccount(key.env.find((v) => v.name === VAULT_GOOGLE_KEY_VAR)?.value ?? '');
    const property = key.env.find((v) => v.name === 'GA_PROPERTY_ID')?.value;
    return `${account ? `, service account ${account.clientEmail}` : ''}${property ? `, default property ${property}` : ''}`;
}

/**
 * The "# Credentials" block appended to the system prompt: which resource
 * center keys the session's machine can use and how. Never contains a secret.
 *
 * Must be deterministic (sorted, no timestamps): the CLI hashes the appended
 * prompt and restarts the agent whenever it changes.
 */
export function buildVaultPromptSection(keys: VaultKey[], machineId: string | undefined, cliVersion: string | undefined, sessionCliVersion?: string): string | null {
    if (!machineId || !isVersionSupported(cliVersion, VAULT_MIN_CLI_VERSION)) return null;
    // `happy run` is whatever CLI the machine has now, but save_key / delete_key come from the
    // session's own CLI process, which keeps the version it started with until it restarts.
    const manage = isVersionSupported(sessionCliVersion, VAULT_TOOLS_MIN_CLI_VERSION) ? EDIT_KEYS : NEED_KEY;
    // A CLI too old for a kind skips those keys when it reads them, so they are not offered here.
    const usable = keys
        .filter((key) => vaultKeyDevices(key).includes(machineId) && isVersionSupported(cliVersion, vaultKindMinCliVersion(key.kind)))
        .sort((a, b) => a.slug.localeCompare(b.slug));
    if (usable.length === 0) {
        return [
            '# Credentials',
            '',
            'The user keeps credentials (cloud accounts, server logins) in Happy\'s resource center, but none are enabled for this machine yet.'
            + ` ${manage}`
            + ` ${KEY_FILES}`,
        ].join('\n');
    }

    const lines = usable.map((key) => {
        const parts = [
            `- \`${key.slug}\` (${key.name}${key.ssh ? `, login ${key.ssh.user}@${key.ssh.host}` : ''}${key.kind === 'email' ? `, mailbox ${key.env.find((v) => v.name === 'MAIL_ADDRESS')?.value ?? '?'}` : ''}${key.kind === 'google' ? googleAccount(key) : ''})`,
            `allow: ${key.allow.map((rule) => `\`${rule}\``).join(', ') || 'nothing yet'}`,
            key.deny.length ? `deny: ${key.deny.map((rule) => `\`${rule}\``).join(', ')}` : null,
            ...key.scope.map((scope) => `covers ${scope.name}${scope.protected ? ` (do not touch: ${scope.protected})` : ''}`),
            key.kind === 'google' ? `Google Analytics with \`happy run ${key.slug} -- happy ga data runReport --body '<RunReportRequest JSON>'\` (other Data API methods likewise, --property <id> for another property); \`happy run ${key.slug} -- happy ga admin get accountSummaries\` lists the properties it can see; settings changes are \`happy run ${key.slug} -- happy ga admin change <POST|PATCH|DELETE> <path>\`; \`happy ga --help\` for the rest` : null,
            key.kind === 'email' ? `send with \`happy run ${key.slug} -- happy mail send --to <address> --subject <text> --body <text>\` (or --body-file <path>); \`happy run ${key.slug} -- happy mail check\` tests the login` : null,
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
        + ` ${manage}`
        + ` ${KEY_FILES}`
        + ' `happy keys` lists the details.',
        '',
        ...lines,
    ].join('\n');
}
