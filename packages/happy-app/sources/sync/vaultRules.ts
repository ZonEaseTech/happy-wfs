import type { VaultKey, VaultKeyKind } from 'happy-wire';
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
export const VAULT_FIELD_LABELS: Record<string, { label: string; where?: () => string; optional?: true }> = {
    CLOUDFLARE_API_TOKEN: { label: 'API Token', where: () => t('resources.whereCfToken') },
    CLOUDFLARE_ACCOUNT_ID: { label: 'Account ID', where: () => t('resources.whereCfAccount'), optional: true },
    ALIYUN_ACCESS_KEY_ID: { label: 'AccessKey ID' },
    ALIYUN_ACCESS_KEY_SECRET: { label: 'AccessKey Secret', where: () => t('resources.whereAliSecret') },
    GH_TOKEN: { label: 'Token', where: () => t('resources.whereGithub') },
    NPM_TOKEN: { label: 'Token', where: () => t('resources.whereNpm') },
};

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
export type VaultPasteGuess = { kind: VaultKeyKind; as: 'secret' | 'id' | 'privateKey' | 'address' };

export function detectVaultPaste(raw: string): VaultPasteGuess | null {
    const value = raw.trim();
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
    const fallback: Record<VaultKeyKind, string> = { cloudflare: 'cloudflare', aliyun: 'aliyun', github: 'github', npm: 'npm', ssh: 'server', custom: 'secret' };
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
        custom: t('resources.sayCustom', { name }),
    }[key.kind];
}
