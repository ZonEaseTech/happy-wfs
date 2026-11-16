import { parseGoogleServiceAccount, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { t } from '@/text';

/**
 * Plain-language names for the commands a key can run. The ones a kind's
 * preset turns on (VAULT_KIND_PRESETS) come first; the rest are offered off,
 * risky ones marked. Rules not listed here show as their raw pattern.
 */
export type VaultRuleOption = { pattern: string; label: () => string; risk?: true };

export const VAULT_RULE_OPTIONS: Record<VaultKeyKind, VaultRuleOption[]> = {
    cloudflare: [
        { pattern: 'npx wrangler deploy*', label: () => t('resources.ruleCfDeploy') },
        { pattern: 'npx wrangler pages deploy *', label: () => t('resources.ruleCfPages') },
        { pattern: 'npx wrangler deployments *', label: () => t('resources.ruleCfDeployments') },
        { pattern: 'npx wrangler whoami', label: () => t('resources.ruleCfWhoami') },
        { pattern: 'npx wrangler delete*', label: () => t('resources.ruleCfDelete'), risk: true },
    ],
    aliyun: [
        { pattern: 'alidns list *', label: () => t('resources.ruleDnsList') },
        { pattern: 'alidns add *', label: () => t('resources.ruleDnsAdd') },
        { pattern: 'alidns delete *', label: () => t('resources.ruleDnsDelete'), risk: true },
    ],
    github: [
        { pattern: 'git push *', label: () => t('resources.ruleGitPush') },
        { pattern: 'gh pr create *', label: () => t('resources.ruleGhPr') },
        { pattern: 'gh release create *', label: () => t('resources.ruleGhRelease') },
    ],
    npm: [
        { pattern: 'npm publish*', label: () => t('resources.ruleNpmPublish') },
        { pattern: 'npm unpublish*', label: () => t('resources.ruleNpmUnpublish'), risk: true },
    ],
    ssh: [
        { pattern: '*', label: () => t('resources.anyCommand') },
    ],
    email: [
        { pattern: 'happy mail send *', label: () => t('resources.ruleMailSend') },
        { pattern: 'happy mail check', label: () => t('resources.ruleMailCheck') },
    ],
    google: [
        { pattern: 'happy ga data *', label: () => t('resources.ruleGaData') },
        { pattern: 'happy ga admin get *', label: () => t('resources.ruleGaAdminGet') },
        { pattern: 'happy ga admin change *', label: () => t('resources.ruleGaAdminChange'), risk: true },
    ],
    'google-login': [{ pattern: 'happy oauth check', label: () => t('resources.ruleOauthCheck') }],
    'apple-login': [{ pattern: 'happy oauth check', label: () => t('resources.ruleOauthCheck') }],
    'facebook-login': [{ pattern: 'happy oauth check', label: () => t('resources.ruleOauthCheck') }],
    custom: [],
};

const DENY_LABELS: Record<string, () => string> = {
    '*image prune -a*': () => t('resources.denyImagePrune'),
    '*system prune*': () => t('resources.denySystemPrune'),
    'rm -rf /*': () => t('resources.denyRmRoot'),
    'git push --force*': () => t('resources.denyForcePush'),
    'git push -f*': () => t('resources.denyForcePushShort'),
};

/** What each preset variable is called on the provider's own site, and where to find it. */
export const VAULT_FIELD_LABELS: Record<string, { label: string | (() => string); where?: () => string; optional?: true; multiline?: true }> = {
    CLOUDFLARE_API_TOKEN: { label: 'API Token', where: () => t('resources.whereCfToken') },
    CLOUDFLARE_ACCOUNT_ID: { label: 'Account ID', where: () => t('resources.whereCfAccount'), optional: true },
    ALIYUN_ACCESS_KEY_ID: { label: 'AccessKey ID' },
    ALIYUN_ACCESS_KEY_SECRET: { label: 'AccessKey Secret', where: () => t('resources.whereAliSecret') },
    GH_TOKEN: { label: 'Token', where: () => t('resources.whereGithub') },
    NPM_TOKEN: { label: 'Token', where: () => t('resources.whereNpm') },
    MAIL_ADDRESS: { label: () => t('resources.fieldMailAddress'), where: () => t('resources.whereMailAddress') },
    MAIL_PASSWORD: { label: () => t('resources.fieldMailPassword'), where: () => t('resources.whereMailPassword') },
    SMTP_HOST: { label: () => t('resources.fieldSmtpHost') },
    SMTP_PORT: { label: () => t('resources.fieldSmtpPort') },
    IMAP_HOST: { label: () => t('resources.fieldImapHost'), optional: true },
    IMAP_PORT: { label: () => t('resources.fieldImapPort'), optional: true },
    GOOGLE_SERVICE_ACCOUNT: { label: () => t('resources.fieldGoogleKey'), where: () => t('resources.whereGoogleKey') },
    GA_PROPERTY_ID: { label: () => t('resources.fieldGaProperty'), where: () => t('resources.whereGaProperty'), optional: true },
    GOOGLE_CLIENT_ID: { label: () => t('resources.fieldGoogleClientId'), where: () => t('resources.whereGoogleClientId') },
    GOOGLE_CLIENT_SECRET: { label: () => t('resources.fieldGoogleClientSecret'), where: () => t('resources.whereGoogleClientSecret') },
    GOOGLE_IOS_CLIENT_ID: { label: () => t('resources.fieldGoogleIosClientId'), where: () => t('resources.whereGoogleIosClientId'), optional: true },
    GOOGLE_ANDROID_CLIENT_ID: { label: () => t('resources.fieldGoogleAndroidClientId'), where: () => t('resources.whereGoogleAndroidClientId'), optional: true },
    APPLE_TEAM_ID: { label: 'Team ID', where: () => t('resources.whereAppleTeamId') },
    APPLE_KEY_ID: { label: 'Key ID', where: () => t('resources.whereAppleKeyId') },
    APPLE_SERVICES_ID: { label: () => t('resources.fieldAppleServicesId'), where: () => t('resources.whereAppleServicesId'), optional: true },
    APPLE_BUNDLE_ID: { label: () => t('resources.fieldAppleBundleId'), where: () => t('resources.whereAppleBundleId'), optional: true },
    APPLE_PRIVATE_KEY: { label: () => t('resources.fieldApplePrivateKey'), where: () => t('resources.whereApplePrivateKey'), multiline: true },
    FACEBOOK_APP_ID: { label: 'App ID', where: () => t('resources.whereFacebookAppId') },
    FACEBOOK_APP_SECRET: { label: 'App Secret', where: () => t('resources.whereFacebookAppSecret') },
    FACEBOOK_CLIENT_TOKEN: { label: 'Client Token', where: () => t('resources.whereFacebookClientToken'), optional: true },
};

/** What a variable is called on screen: the provider's own name for it, or the variable itself. */
export function vaultFieldLabel(name: string): string {
    const label = VAULT_FIELD_LABELS[name]?.label;
    return typeof label === 'function' ? label() : label ?? name;
}

/**
 * Mailboxes whose servers are filled in for the user. Outlook / Microsoft 365 are left out on
 * purpose: they no longer accept a password over SMTP or IMAP, only OAuth.
 */
export type VaultMailProvider = { id: string; label: () => string; smtp: [string, number]; imap: [string, number] };
export const VAULT_MAIL_PROVIDERS: VaultMailProvider[] = [
    { id: 'lark', label: () => t('resources.mailLark'), smtp: ['smtp.larksuite.com', 465], imap: ['imap.larksuite.com', 993] },
    { id: 'feishu', label: () => t('resources.mailFeishu'), smtp: ['smtp.feishu.cn', 465], imap: ['imap.feishu.cn', 993] },
    { id: 'exmail', label: () => t('resources.mailExmail'), smtp: ['smtp.exmail.qq.com', 465], imap: ['imap.exmail.qq.com', 993] },
    { id: 'aliyun', label: () => t('resources.mailAliyun'), smtp: ['smtp.qiye.aliyun.com', 465], imap: ['imap.qiye.aliyun.com', 993] },
    { id: 'qq', label: () => t('resources.mailQq'), smtp: ['smtp.qq.com', 465], imap: ['imap.qq.com', 993] },
    { id: '163', label: () => t('resources.mail163'), smtp: ['smtp.163.com', 465], imap: ['imap.163.com', 993] },
    { id: 'gmail', label: () => 'Gmail', smtp: ['smtp.gmail.com', 465], imap: ['imap.gmail.com', 993] },
];

export type VaultMailSettings = { address?: string; password?: string; smtpHost?: string; smtpPort?: number; imapHost?: string; imapPort?: number };

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/**
 * A mailbox's "IMAP/SMTP" settings as pasted from the provider. Lark puts each label on its own
 * line with the value under it, others write "label: value"; both are read. Null unless it names
 * an SMTP or IMAP server.
 */
export function parseMailSettings(raw: string): VaultMailSettings | null {
    const hosts: string[] = raw.match(/\b(?:smtp|imap)(?:[\w-]*\.)+[a-z]{2,}\b/gi) ?? [];
    const smtpHost = hosts.find((host) => /^smtp/i.test(host))?.toLowerCase();
    const imapHost = hosts.find((host) => /^imap/i.test(host))?.toLowerCase();
    if (!smtpHost && !imapHost) return null;

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < lines.length; i++) {
        const inline = /^(.+?)\s*[:：]\s*(\S+)$/.exec(lines[i]);
        if (inline) pairs.push([inline[1].toLowerCase(), inline[2]]);
        else if (i + 1 < lines.length && !/\s/.test(lines[i + 1])) pairs.push([lines[i].toLowerCase(), lines[++i]]);
    }
    const port = (server: 'smtp' | 'imap') => {
        const ports = pairs.filter(([label, value]) => label.includes(server) && !label.includes(server === 'smtp' ? 'imap' : 'smtp') && /^\d{2,5}$/.test(value));
        const value = (ports.find(([label]) => label.includes('ssl')) ?? ports[0])?.[1];
        return value ? Number(value) : undefined;
    };
    const password = pairs.find(([label, value]) => /密码|密碼|授权码|授權碼|password|authorization/.test(label) && !EMAIL.test(value) && !hosts.includes(value))?.[1];
    return { smtpHost, imapHost, smtpPort: port('smtp'), imapPort: port('imap'), password, address: EMAIL.exec(raw)?.[0] };
}

export const matchMailProvider = (settings: VaultMailSettings): VaultMailProvider | undefined => (
    VAULT_MAIL_PROVIDERS.find((provider) => provider.smtp[0] === settings.smtpHost || provider.imap[0] === settings.imapHost)
);

export const vaultDenyLabel = (pattern: string): string => DENY_LABELS[pattern]?.() ?? pattern;

/** One line saying what a key can do, e.g. "Deploy Worker, Deploy Pages" or "Any command, 3 not allowed". */
export function vaultCanDo(key: Pick<VaultKey, 'kind' | 'allow' | 'deny'>): string {
    if (key.allow.includes('*')) {
        return key.deny.length ? t('resources.anyCommandExcept', { count: key.deny.length }) : t('resources.anyCommand');
    }
    const named = VAULT_RULE_OPTIONS[key.kind].filter((option) => key.allow.includes(option.pattern)).map((option) => option.label());
    const custom = key.allow.length - named.length;
    if (named.length === 0 && custom === 0) return t('resources.canDoNothing');
    if (custom === 0) return named.join(t('resources.listSeparator'));
    if (named.length === 0) return t('resources.customRules', { count: custom });
    return `${named.join(t('resources.listSeparator'))} ${t('resources.plusCustom', { count: custom })}`;
}

/**
 * What a pasted value most likely is. Only formats with a fixed shape are
 * recognised; everything else (a Cloudflare token, a password) returns null
 * and the user picks the type.
 */
export type VaultPasteGuess = { kind: VaultKeyKind; as: 'secret' | 'id' | 'privateKey' | 'address' | 'settings' | 'serviceAccount' };

export function detectVaultPaste(raw: string): VaultPasteGuess | null {
    const value = raw.trim();
    if (parseGoogleServiceAccount(value)) return { kind: 'google', as: 'serviceAccount' };
    if (/^GOCSPX-[\w-]{20,}$/.test(value)) return { kind: 'google-login', as: 'secret' };
    if (/^[\w-]+\.apps\.googleusercontent\.com$/.test(value)) return { kind: 'google-login', as: 'id' };
    // Apple's .p8 is a short PKCS#8 EC key; server keys are longer or say OPENSSH / RSA.
    if (/^-----BEGIN PRIVATE KEY-----[\s\S]{1,400}-----END PRIVATE KEY-----$/.test(value)) return { kind: 'apple-login', as: 'privateKey' };
    if (parseMailSettings(value)) return { kind: 'email', as: 'settings' };
    if (/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return { kind: 'ssh', as: 'privateKey' };
    if (/^(ghp_|gho_|ghs_|github_pat_)\w{20,}$/.test(value)) return { kind: 'github', as: 'secret' };
    if (/^npm_\w{20,}$/.test(value)) return { kind: 'npm', as: 'secret' };
    if (/^LTAI\w{12,}$/.test(value)) return { kind: 'aliyun', as: 'id' };
    if (/^[\w.-]+@[\w.-]+\.[\w.-]+(:\d{1,5})?$/.test(value) || /^[\w.-]+@\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(value)) return { kind: 'ssh', as: 'address' };
    return null;
}

/** `dev@43.239.84.25:2222` → user, host, port. */
export function parseSshAddress(value: string): { user: string; host: string; port: number } | null {
    const match = /^([\w.-]+)@([\w.-]+)(?::(\d{1,5}))?$/.exec(value.trim());
    if (!match) return null;
    const port = match[3] ? Number(match[3]) : 22;
    return port > 0 && port < 65536 ? { user: match[1], host: match[2], port } : null;
}

/** A command name that is free: from the key's name when it has latin letters, else from its type. */
export function vaultAutoSlug(name: string, kind: VaultKeyKind, taken: string[]): string {
    const fallback: Record<VaultKeyKind, string> = { cloudflare: 'cloudflare', aliyun: 'aliyun', github: 'github', npm: 'npm', ssh: 'server', email: 'mail', google: 'google', 'google-login': 'google-login', 'apple-login': 'apple-login', 'facebook-login': 'facebook-login', custom: 'secret' };
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || fallback[kind];
    let slug = base;
    for (let i = 2; taken.includes(slug); i++) slug = `${base}-${i}`;
    return slug;
}

/** A sentence the user can say in a session to use this key, shown with a copy button. */
export function vaultSay(key: Pick<VaultKey, 'kind' | 'name'>): string {
    const name = key.name;
    return {
        cloudflare: t('resources.sayCloudflare', { name }),
        aliyun: t('resources.sayAliyun', { name }),
        github: t('resources.sayGithub', { name }),
        npm: t('resources.sayNpm', { name }),
        ssh: t('resources.saySsh', { name }),
        email: t('resources.sayEmail', { name }),
        google: t('resources.sayGoogle', { name }),
        'google-login': t('resources.sayOauth', { name }),
        'apple-login': t('resources.sayOauth', { name }),
        'facebook-login': t('resources.sayOauth', { name }),
        custom: t('resources.sayCustom', { name }),
    }[key.kind];
}
