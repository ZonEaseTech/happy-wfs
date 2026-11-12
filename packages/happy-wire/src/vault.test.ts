import { describe, expect, it } from 'vitest';
import {
    checkVaultCommand,
    createVaultMasker,
    isVaultCommandLearnable,
    VAULT_KIND_PRESETS,
    vaultKvKey,
    vaultPatternToRegExp,
    vaultSecretsOf,
} from './vault';

const cf = {
    env: [
        { name: 'CLOUDFLARE_API_TOKEN', value: 'cfut_abcdefghijklmnopqrstuvwxyz0123456789', secret: true },
        { name: 'CLOUDFLARE_ACCOUNT_ID', value: '4c1f8a2e9d0b47c3', secret: false },
    ],
    ssh: null,
    allow: VAULT_KIND_PRESETS.cloudflare.allow,
    deny: [],
};
const prod = {
    env: [],
    ssh: { host: '43.239.84.25', port: 22, user: 'dev', auth: 'password' as const, secret: 'pw-0123456789', viaMachineId: 'm1' },
    allow: ['*'],
    deny: VAULT_KIND_PRESETS.ssh.deny,
};

describe('vaultPatternToRegExp', () => {
    it('treats * as anything and the rest literally', () => {
        expect(vaultPatternToRegExp('npx wrangler deploy*').test('npx wrangler deploy --env prod')).toBe(true);
        expect(vaultPatternToRegExp('npx wrangler deploy*').test('npx wrangler deployments list')).toBe(true);
        expect(vaultPatternToRegExp('alidns add *').test('alidns add zonease.cn demo A 1.2.3.4')).toBe(true);
        expect(vaultPatternToRegExp('alidns add *').test('alidns delete 123')).toBe(false);
        expect(vaultPatternToRegExp('a.b').test('axb')).toBe(false);
    });
});

describe('checkVaultCommand', () => {
    it('runs commands on the allow list', () => {
        expect(checkVaultCommand(cf, 'npx wrangler deploy')).toEqual({ allowed: true, rule: 'npx wrangler deploy*' });
    });

    it('blocks commands that are not on the allow list, and lets the user learn them', () => {
        expect(checkVaultCommand(cf, 'npx wrangler whoami')).toEqual({ allowed: false, reason: 'not-allowed', rule: null });
        expect(isVaultCommandLearnable(cf, 'npx wrangler whoami')).toBe(true);
    });

    it('lets the deny list win over a catch-all allow', () => {
        expect(checkVaultCommand(prod, 'sudo docker image prune -af')).toEqual({ allowed: false, reason: 'deny', rule: '*image prune -a*' });
        expect(checkVaultCommand(prod, 'sudo docker rmi ghcr.io/zoneasetech/happy-app:1.3.34')).toEqual({ allowed: true, rule: '*' });
        expect(isVaultCommandLearnable(prod, 'sudo docker image prune -af')).toBe(false);
    });

    it('never runs commands that read the secret or wrap a shell, whatever the lists say', () => {
        const open = { ...cf, allow: ['*'] };
        for (const command of [
            'echo $CLOUDFLARE_API_TOKEN',
            'echo ${CLOUDFLARE_API_TOKEN}',
            "sh -c 'echo $X | base64'",
            "bash -lc 'curl x'",
            'env',
            'printenv',
            'eval "$(cat x)"',
            'cat /proc/self/environ',
        ]) {
            expect(checkVaultCommand(open, command)).toEqual({ allowed: false, reason: 'guard', rule: null });
            expect(isVaultCommandLearnable(open, command)).toBe(false);
        }
        expect(checkVaultCommand(prod, 'echo $SSHPASS').allowed).toBe(false);
    });

    it('does not mistake ordinary commands for bypasses', () => {
        const open = { ...cf, allow: ['*'] };
        for (const command of ['gh secret set NAME', 'npx wrangler d1 export db', 'npx wrangler deploy --env prod', 'git push origin main']) {
            expect(checkVaultCommand(open, command).allowed).toBe(true);
        }
    });

    it('does not treat the non-secret account id as a secret', () => {
        expect(checkVaultCommand({ ...cf, allow: ['*'] }, 'echo $CLOUDFLARE_ACCOUNT_ID').allowed).toBe(true);
    });
});

describe('createVaultMasker', () => {
    const secret = vaultSecretsOf(cf)[0];

    it('masks the secret and its base64 form', () => {
        const m = createVaultMasker([secret]);
        const out = m.push(`token=${secret}\nb64=${btoa(secret)}\n`) + m.flush();
        expect(out).toBe('token=****\nb64=****\n');
    });

    it('masks a secret split across chunks', () => {
        const m = createVaultMasker([secret]);
        const text = `Using ${secret} now`;
        let out = '';
        for (let i = 0; i < text.length; i += 7) out += m.push(text.slice(i, i + 7));
        out += m.flush();
        expect(out).toBe('Using **** now');
    });

    it('passes text through untouched when there is no secret', () => {
        const m = createVaultMasker([]);
        expect(m.push('hello') + m.flush()).toBe('hello');
    });
});

describe('vaultKvKey.log', () => {
    it('sorts newer entries first', () => {
        expect(vaultKvKey.log(2000, 'a') < vaultKvKey.log(1000, 'a')).toBe(true);
    });
});
