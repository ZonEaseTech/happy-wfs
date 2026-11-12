import { describe, expect, it, vi } from 'vitest';
import { VAULT_KIND_PRESETS, VaultKeyKindSchema } from 'happy-wire';

vi.mock('@/text', () => ({ t: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
import { VAULT_RULE_OPTIONS, detectVaultPaste, parseSshAddress, vaultAutoSlug, vaultCanDo } from './vaultRules';

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
