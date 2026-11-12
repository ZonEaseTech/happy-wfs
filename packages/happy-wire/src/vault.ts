import { z } from 'zod';

/**
 * Resource center ("vault"): credentials the user stores in Happy so agents can
 * use them without ever seeing them.
 *
 * Storage is the user KV store, which the server keeps as opaque bytes:
 *   - `vault:key:<id>`                 the account record, encrypted by the app for the account
 *   - `vault:dev:<machineId>:<id>`     one copy per allowed device, encrypted with that device's data key
 *   - `vault:log:<rev-ts>-<rand>`      one usage entry per run, sealed by the CLI to the account public key
 *
 * Agents use a key with `happy run <slug> -- <command>`: the CLI on the device
 * decrypts its copy, checks the command against the key's rules, injects the
 * secrets into that one command and masks them in its output.
 */

export const VAULT_MIN_CLI_VERSION = '0.6.63';

export const VaultKeyKindSchema = z.enum(['cloudflare', 'aliyun', 'github', 'npm', 'ssh', 'custom']);
export type VaultKeyKind = z.infer<typeof VaultKeyKindSchema>;

export const VaultEnvVarSchema = z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    value: z.string(),
    secret: z.boolean(),
});
export type VaultEnvVar = z.infer<typeof VaultEnvVarSchema>;

export const VaultSshSchema = z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1),
    auth: z.enum(['password', 'key']),
    secret: z.string().min(1),
    viaMachineId: z.string(),
});
export type VaultSsh = z.infer<typeof VaultSshSchema>;

export const VaultScopeSchema = z.object({
    name: z.string(),
    protected: z.string(),
});
export type VaultScope = z.infer<typeof VaultScopeSchema>;

const vaultKeyFields = {
    v: z.literal(1),
    id: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    kind: VaultKeyKindSchema,
    name: z.string().min(1),
    env: z.array(VaultEnvVarSchema),
    ssh: VaultSshSchema.nullable(),
    allow: z.array(z.string()),
    deny: z.array(z.string()),
    scope: z.array(VaultScopeSchema),
    updatedAt: z.number(),
};

/** Account record: everything, plus which devices get a copy. */
export const VaultKeySchema = z.object({ ...vaultKeyFields, machineIds: z.array(z.string()) });
export type VaultKey = z.infer<typeof VaultKeySchema>;

/**
 * Device copy. `machineId` is inside the ciphertext so a copy moved to another
 * KV key (any device token can write the whole KV) is rejected on decrypt.
 */
export const VaultDeviceCopySchema = z.object({ ...vaultKeyFields, machineId: z.string() });
export type VaultDeviceCopy = z.infer<typeof VaultDeviceCopySchema>;

export const VaultDenyReasonSchema = z.enum(['guard', 'deny', 'not-allowed']);
export type VaultDenyReason = z.infer<typeof VaultDenyReasonSchema>;

export const VaultUsageLogSchema = z.object({
    v: z.literal(1),
    at: z.number(),
    keyId: z.string(),
    slug: z.string(),
    keyName: z.string(),
    machineId: z.string(),
    sessionId: z.string().nullable(),
    cwd: z.string(),
    command: z.string(),
    outcome: z.enum(['ok', 'failed', 'denied']),
    reason: VaultDenyReasonSchema.nullable(),
    rule: z.string().nullable(),
    exitCode: z.number().nullable(),
    durationMs: z.number().nullable(),
});
export type VaultUsageLog = z.infer<typeof VaultUsageLogSchema>;

export const vaultKvKey = {
    key: (id: string) => `vault:key:${id}`,
    keyPrefix: 'vault:key:',
    device: (machineId: string, id: string) => `vault:dev:${machineId}:${id}`,
    devicePrefix: (machineId: string) => `vault:dev:${machineId}:`,
    logPrefix: 'vault:log:',
    /** Reverse timestamp so the server's ascending key order lists newest first. */
    log: (at: number, rand: string) => `vault:log:${String(9_999_999_999_999 - at).padStart(13, '0')}-${rand}`,
};

/** Defaults a kind starts with in the editor. `allow` empty = nothing runs until the user adds rules. */
export const VAULT_KIND_PRESETS: Record<VaultKeyKind, { env: Array<{ name: string; secret: boolean }>; allow: string[]; deny: string[] }> = {
    cloudflare: {
        env: [{ name: 'CLOUDFLARE_API_TOKEN', secret: true }, { name: 'CLOUDFLARE_ACCOUNT_ID', secret: false }],
        allow: ['npx wrangler deploy*', 'npx wrangler deployments *', 'npx wrangler pages deploy *'],
        deny: [],
    },
    aliyun: {
        env: [{ name: 'ALIYUN_ACCESS_KEY_ID', secret: false }, { name: 'ALIYUN_ACCESS_KEY_SECRET', secret: true }],
        allow: ['alidns list *', 'alidns add *'],
        deny: [],
    },
    github: {
        env: [{ name: 'GH_TOKEN', secret: true }],
        allow: ['git push *', 'gh pr create *', 'gh release create *'],
        deny: ['git push --force*', 'git push -f*'],
    },
    npm: {
        env: [{ name: 'NPM_TOKEN', secret: true }],
        allow: ['npm publish*'],
        deny: [],
    },
    ssh: {
        env: [],
        allow: ['*'],
        deny: ['*image prune -a*', '*system prune*', 'rm -rf /*'],
    },
    custom: {
        env: [{ name: 'MY_SECRET', secret: true }],
        allow: [],
        deny: [],
    },
};

/** `*` matches anything (including nothing); everything else is literal. */
export function vaultPatternToRegExp(pattern: string): RegExp {
    const body = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}$`, 's');
}

/** The env names a command could read the secrets through. */
function secretVarNames(key: Pick<VaultKey, 'env' | 'ssh'>): string[] {
    const names = key.env.filter(v => v.secret).map(v => v.name);
    return key.ssh ? [...names, 'SSHPASS'] : names;
}

// Wrappers that would let a command smuggle anything past the rules.
// (`set` / `export` are left out on purpose: `gh secret set`, `wrangler d1 export` are real commands.)
const BYPASS = /(^|[\s;|&(`])(sh|bash|zsh|dash|fish)\s+(-[a-z]*c|-i)\b|(^|[\s;|&(`])(eval|env|printenv)(\s|$)|\/proc\/[^\s]*\/environ/;

export type VaultCheckResult =
    | { allowed: true; rule: string }
    | { allowed: false; reason: VaultDenyReason; rule: string | null };

/**
 * Whether `command` may run with this key. Built-in guard first (never
 * overridable), then the user's deny list, then the allow list.
 */
export function checkVaultCommand(key: Pick<VaultKey, 'env' | 'ssh' | 'allow' | 'deny'>, command: string): VaultCheckResult {
    const trimmed = command.trim();
    const referencesSecret = secretVarNames(key).some(name => trimmed.includes(`$${name}`) || trimmed.includes(`\${${name}`));
    if (referencesSecret || BYPASS.test(trimmed)) return { allowed: false, reason: 'guard', rule: null };

    const denied = key.deny.find(pattern => vaultPatternToRegExp(pattern).test(trimmed));
    if (denied) return { allowed: false, reason: 'deny', rule: denied };

    const allowed = key.allow.find(pattern => vaultPatternToRegExp(pattern).test(trimmed));
    if (allowed) return { allowed: true, rule: allowed };
    return { allowed: false, reason: 'not-allowed', rule: null };
}

/** A denied command the user may add to the allow list in one tap. Guard hits never are. */
export function isVaultCommandLearnable(key: Pick<VaultKey, 'env' | 'ssh' | 'allow' | 'deny'>, command: string): boolean {
    const result = checkVaultCommand(key, command);
    return !result.allowed && result.reason === 'not-allowed';
}

export function vaultSecretsOf(key: Pick<VaultKey, 'env' | 'ssh'>): string[] {
    const values = key.env.filter(v => v.secret).map(v => v.value);
    return [...values, ...(key.ssh ? [key.ssh.secret] : [])].filter(v => v.length >= 4);
}

const encodeBase64 = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
};

/**
 * Replaces secrets in streamed text with `****`. Keeps back the last
 * (longest secret - 1) characters of each chunk so a secret split across two
 * chunks is still caught. Base64 forms are masked too, since tools sometimes
 * print an encoded token; any other encoding is not caught.
 */
export function createVaultMasker(secrets: string[]) {
    const needles = [...new Set(secrets.flatMap(s => [s, encodeBase64(s)]))]
        .filter(s => s.length >= 4)
        .sort((a, b) => b.length - a.length);
    const keep = Math.max(0, ...needles.map(s => s.length)) - 1;
    let pending = '';

    const mask = (text: string) => needles.reduce((out, needle) => out.split(needle).join('****'), text);

    return {
        push(chunk: string): string {
            const masked = mask(pending + chunk);
            const cut = Math.max(0, masked.length - keep);
            pending = masked.slice(cut);
            return masked.slice(0, cut);
        },
        flush(): string {
            const rest = mask(pending);
            pending = '';
            return rest;
        },
    };
}
