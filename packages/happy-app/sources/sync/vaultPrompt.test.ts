import { describe, expect, it } from 'vitest';
import type { VaultKey } from 'happy-wire';
import { buildVaultPromptSection } from './vaultPrompt';

const key = (over: Partial<VaultKey>): VaultKey => ({
    v: 1, id: 'k', slug: 'cf-yyps', kind: 'cloudflare', name: 'Cloudflare · yyps',
    env: [{ name: 'CLOUDFLARE_API_TOKEN', value: 'cfut_SECRET_VALUE', secret: true }],
    ssh: null, allow: ['npx wrangler deploy*'], deny: [], scope: [{ name: 'zonease.org', protected: 'happy、api-happy' }],
    machineIds: ['wfs'], updatedAt: 1, ...over,
});
const prod = key({
    id: 'p', slug: 'vm-node05', kind: 'ssh', name: 'vm-node05 · happy 生产', env: [], machineIds: [],
    ssh: { host: '43.239.84.25', port: 22, user: 'dev', auth: 'password', secret: 'PASSWORD_VALUE', viaMachineId: 'admin' },
    allow: ['*'], deny: ['*image prune -a*'], scope: [],
});

describe('buildVaultPromptSection', () => {
    it('lists only the keys this machine can use, without any secret', () => {
        const wfs = buildVaultPromptSection([prod, key({})], 'wfs', '0.6.63')!;
        expect(wfs).toContain('`cf-yyps`');
        expect(wfs).not.toContain('vm-node05');
        expect(wfs).toContain('do not touch: happy、api-happy');
        expect(wfs).not.toContain('cfut_SECRET_VALUE');

        const admin = buildVaultPromptSection([prod, key({})], 'admin', '0.6.63')!;
        expect(admin).toContain('`vm-node05` (vm-node05 · happy 生产, login dev@43.239.84.25)');
        expect(admin).toContain('deny: `*image prune -a*`');
        expect(admin).not.toContain('PASSWORD_VALUE');
        expect(admin).not.toContain('cf-yyps');
    });

    it('says nothing when the machine has no keys or its CLI cannot run them', () => {
        expect(buildVaultPromptSection([key({})], 'mini', '0.6.63')).toBeNull();
        expect(buildVaultPromptSection([key({})], 'wfs', '0.6.62')).toBeNull();
        expect(buildVaultPromptSection([key({})], undefined, '0.6.63')).toBeNull();
    });

    it('is stable regardless of key order', () => {
        const a = key({ id: 'a', slug: 'a-key', machineIds: ['wfs'] });
        const b = key({ id: 'b', slug: 'b-key', machineIds: ['wfs'] });
        expect(buildVaultPromptSection([a, b], 'wfs', '0.6.63')).toBe(buildVaultPromptSection([b, a], 'wfs', '0.6.63'));
    });
});
