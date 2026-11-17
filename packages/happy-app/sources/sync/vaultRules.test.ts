import { describe, expect, it, vi } from 'vitest';
import { VAULT_KIND_PRESETS, VaultKeyKindSchema, type VaultKeyKind } from 'happy-wire';

vi.mock('@/text', () => ({ t: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
import { VAULT_RULE_OPTIONS, detectVaultPaste, matchMailProvider, parseMailSettings, parseSshAddress, vaultAutoSlug, vaultCanDo, vaultKeyGroups } from './vaultRules';

// Lark's "IMAP/SMTP" page as the user pasted it: each label on its own line, the value under it.
const LARK = `SMTP 地址
smtp.larksuite.com
IMAP/SMTP 密码
Abcd1234Efgh5678
SMTP 端口号（SSL）
465
SMTP 端口号（starttls）
587
IMAP 地址
imap.larksuite.com
IMAP 端口号（SSL）
993
SMTP 发信限制规则发信频率（调用 SMTP 服务的整体频率）200 封/100 秒
单日发信上限（一个发件人单日发信上限）450 封`;

describe('detectVaultPaste', () => {
    it('recognises values with a fixed shape', () => {
        expect(detectVaultPaste('ghp_' + 'a'.repeat(36))).toEqual({ kind: 'github', as: 'secret' });
        expect(detectVaultPaste('github_pat_' + 'A1_'.repeat(20))).toEqual({ kind: 'github', as: 'secret' });
        expect(detectVaultPaste('npm_' + 'b'.repeat(36))).toEqual({ kind: 'npm', as: 'secret' });
        expect(detectVaultPaste('  LTAI5tQ8xR2mVn7KpZ4wE9sJ \n')).toEqual({ kind: 'aliyun', as: 'id' });
        expect(detectVaultPaste('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----')).toEqual({ kind: 'ssh', as: 'privateKey' });
        expect(detectVaultPaste('dev@43.239.84.25')).toEqual({ kind: 'ssh', as: 'address' });
        expect(detectVaultPaste('root@vm-node05.example.com:2222')).toEqual({ kind: 'ssh', as: 'address' });
    });

    it('leaves anything else to the user', () => {
        expect(detectVaultPaste('k0OQwQAN5jPzdS-3PeOErM85fZuWiICmodCCIRHQ')).toBeNull(); // Cloudflare tokens have no prefix
        expect(detectVaultPaste('hunter2')).toBeNull();
        expect(detectVaultPaste('someone@localhost')).toBeNull();
        expect(detectVaultPaste('')).toBeNull();
    });
});

describe('parseMailSettings', () => {
    it('reads a pasted Lark settings page: servers, the SSL ports and the password', () => {
        const settings = parseMailSettings(LARK);
        expect(settings).toEqual({ smtpHost: 'smtp.larksuite.com', smtpPort: 465, imapHost: 'imap.larksuite.com', imapPort: 993, password: 'Abcd1234Efgh5678', address: undefined });
        expect(matchMailProvider(settings!)?.id).toBe('lark');
        expect(detectVaultPaste(LARK)).toEqual({ kind: 'email', as: 'settings' });
    });

    it('reads label: value lines and picks up the address', () => {
        const settings = parseMailSettings('Email: me@corp.example\nSMTP server: smtp.corp.example\nSMTP port: 587\nPassword: s3cret-pass');
        expect(settings).toMatchObject({ smtpHost: 'smtp.corp.example', smtpPort: 587, imapHost: undefined, password: 's3cret-pass', address: 'me@corp.example' });
        expect(matchMailProvider(settings!)).toBeUndefined();
    });

    it('needs a mail server to say anything', () => {
        expect(parseMailSettings('ghp_' + 'a'.repeat(36))).toBeNull();
        expect(parseMailSettings('wfs@ttpos.com')).toBeNull();
    });
});

describe('Google service account keys', () => {
    it('are recognised when the downloaded JSON is pasted', () => {
        const json = JSON.stringify({ type: 'service_account', project_id: 'demo', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n', client_email: 'ga@demo.iam.gserviceaccount.com' }, null, 2);
        expect(detectVaultPaste(json)).toEqual({ kind: 'google', as: 'serviceAccount' });
        expect(detectVaultPaste('{"type":"authorized_user"}')).toBeNull();
    });
});

describe('sign-in credentials', () => {
    it('are recognised by their shape: Google client secrets and IDs, Apple .p8 keys', () => {
        expect(detectVaultPaste('GOCSPX-' + 'a1B2'.repeat(7))).toEqual({ kind: 'google-login', as: 'secret' });
        expect(detectVaultPaste('1234567890-abcdefg.apps.googleusercontent.com')).toEqual({ kind: 'google-login', as: 'id' });
        const p8 = '-----BEGIN PRIVATE KEY-----\n' + 'M'.repeat(64) + '\n' + 'N'.repeat(56) + '\n' + 'O'.repeat(64) + '\n-----END PRIVATE KEY-----';
        expect(detectVaultPaste(p8)).toEqual({ kind: 'apple-login', as: 'privateKey' });
        // A long PKCS#8 key is a server key, not a .p8.
        expect(detectVaultPaste('-----BEGIN PRIVATE KEY-----\n' + 'R'.repeat(1600) + '\n-----END PRIVATE KEY-----')).toEqual({ kind: 'ssh', as: 'privateKey' });
    });
});

describe('parseSshAddress', () => {
    it('splits user, host and port, defaulting to 22', () => {
        expect(parseSshAddress('dev@43.239.84.25')).toEqual({ user: 'dev', host: '43.239.84.25', port: 22 });
        expect(parseSshAddress(' root@box.example.com:2222 ')).toEqual({ user: 'root', host: 'box.example.com', port: 2222 });
        expect(parseSshAddress('43.239.84.25')).toBeNull();
        expect(parseSshAddress('dev@host:70000')).toBeNull();
    });
});

describe('vaultAutoSlug', () => {
    it('uses the name when it has latin letters, else the type, and never collides', () => {
        expect(vaultAutoSlug('Cloudflare · yyps', 'cloudflare', [])).toBe('cloudflare-yyps');
        expect(vaultAutoSlug('阿里云解析', 'aliyun', [])).toBe('aliyun');
        expect(vaultAutoSlug('GitHub', 'github', ['github', 'github-2'])).toBe('github-3');
    });
});

describe('rule options', () => {
    it('cover every rule a preset turns on, so a new key reads in plain words', () => {
        for (const kind of VaultKeyKindSchema.options) {
            const patterns = VAULT_RULE_OPTIONS[kind].map((option) => option.pattern);
            for (const rule of VAULT_KIND_PRESETS[kind].allow) expect(patterns).toContain(rule);
        }
    });

    it('summarise any-command keys by how many things they refuse', () => {
        expect(vaultCanDo({ kind: 'ssh', allow: ['*'], deny: ['a', 'b'] })).toMatch(/2/);
        expect(vaultCanDo({ kind: 'custom', allow: [], deny: [] })).not.toBe('');
    });
});

describe('vaultKeyGroups', () => {
    const key = (kind: VaultKeyKind, name: string) => ({ kind, name });

    it('lists keys by what they are for, in a fixed order, without the groups that have none', () => {
        const groups = vaultKeyGroups([key('custom', 'ops'), key('github', 'GitHub'), key('aliyun', 'DNS'), key('custom', 'mail'), key('cloudflare', 'CF'), key('apple-login', 'Apple')]);
        expect(groups.map((entry) => [entry.group, entry.keys.map((k) => k.name)])).toEqual([
            ['cloud', ['DNS', 'CF']],
            ['code', ['GitHub']],
            ['signIn', ['Apple']],
            ['other', ['ops', 'mail']],
        ]);
    });

    it('has a group for every kind of key', () => {
        const all = VaultKeyKindSchema.options.map((kind) => key(kind, kind));
        expect(vaultKeyGroups(all).flatMap((entry) => entry.keys)).toHaveLength(all.length);
        expect(vaultKeyGroups([])).toEqual([]);
    });
});
