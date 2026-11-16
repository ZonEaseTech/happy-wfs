import { describe, expect, it, vi } from 'vitest';
import type { VaultKey } from 'happy-wire';

vi.mock('@/text', () => ({ t: (key: string) => key }));
import { buildVaultProposal, vaultKeyUnchanged, vaultProposalTool } from './vaultProposal';

const github: VaultKey = {
    v: 1, id: 'gh', slug: 'github', kind: 'github', name: 'GitHub',
    env: [{ name: 'GH_TOKEN', value: 'ghp_OLD', secret: true }],
    ssh: null, allow: ['git push *'], deny: ['git push --force*'], scope: [], machineIds: ['admin'], updatedAt: 5,
};
const server: VaultKey = {
    v: 1, id: 'srv', slug: 'vm-node05', kind: 'ssh', name: 'vm-node05', env: [],
    ssh: { host: '43.239.84.25', port: 22, user: 'dev', auth: 'password', secret: 'PW', viaMachineId: 'admin' },
    allow: ['*'], deny: [], scope: [], machineIds: [], updatedAt: 5,
};
const devices = [
    { id: 'admin', name: 'coder admin', online: true },
    { id: 'wfs', name: 'coder wfs', online: true },
    { id: 'mini', name: 'mac mini', online: false },
];
const keys = [github, server];

const lark = {
    name: 'Lark mail',
    env: [
        { name: 'SMTP_HOST', value: 'smtp.larksuite.com', secret: false },
        { name: 'SMTP_PORT', value: '465', secret: false },
        { name: 'SMTP_USER', secret: false },
        { name: 'SMTP_PASSWORD', value: ' app-password ' },
    ],
    allow: ['python3 send_mail.py *'],
};

describe('vaultProposalTool', () => {
    it('knows the two key tools under either naming', () => {
        expect(vaultProposalTool('mcp__happy__save_key')).toBe('save_key');
        expect(vaultProposalTool('mcp:happy:delete_key')).toBe('delete_key');
        expect(vaultProposalTool('mcp__happy__preview_html')).toBeNull();
        expect(vaultProposalTool('mcp__other__save_key')).toBeNull();
    });
});

describe('buildVaultProposal', () => {
    it('drafts a new key from what the agent was given, asking only for what it was not', () => {
        const proposal = buildVaultProposal('save_key', lark, keys, devices);
        expect(proposal.action).toBe('add');
        if (proposal.action !== 'add') return;
        expect(proposal.key).toMatchObject({ id: '', kind: 'custom', slug: 'lark-mail', name: 'Lark mail', allow: ['python3 send_mail.py *'], deny: [] });
        expect(proposal.key.env).toEqual([
            { name: 'SMTP_HOST', value: 'smtp.larksuite.com', secret: false },
            { name: 'SMTP_PORT', value: '465', secret: false },
            { name: 'SMTP_USER', value: '', secret: false },
            { name: 'SMTP_PASSWORD', value: 'app-password', secret: true },
        ]);
        expect(proposal.missing).toEqual(['SMTP_USER']);
        // Like the add form: every online device unless the agent names some.
        expect(proposal.key.machineIds).toEqual(['admin', 'wfs']);
    });

    it('starts a typed key from its preset, so a GitHub token lands in GH_TOKEN with the usual rules', () => {
        const proposal = buildVaultProposal('save_key', { name: 'GitHub work', kind: 'github', devices: ['coder wfs'] }, keys, devices);
        expect(proposal).toMatchObject({ action: 'add', missing: ['GH_TOKEN'], key: { slug: 'github-work', allow: ['git push *', 'gh pr create *', 'gh release create *'], machineIds: ['wfs'] } });
    });

    it('drafts a mailbox from its preset, leaving out IMAP when the agent has none', () => {
        const proposal = buildVaultProposal('save_key', { name: 'Lark mail', kind: 'email', env: [{ name: 'MAIL_ADDRESS', value: 'wfs@ttpos.com' }, { name: 'SMTP_HOST', value: 'smtp.larksuite.com' }, { name: 'SMTP_PORT', value: '465' }] }, keys, devices);
        expect(proposal).toMatchObject({ action: 'add', missing: ['MAIL_PASSWORD'], key: { kind: 'email', allow: ['happy mail send *', 'happy mail check'] } });
        if (proposal.action !== 'add') return;
        expect(proposal.key.env.map((v) => [v.name, v.secret])).toEqual([['MAIL_ADDRESS', false], ['MAIL_PASSWORD', true], ['SMTP_HOST', false], ['SMTP_PORT', false]]);
    });

    it('drafts a Google key with its property, leaving the JSON key to the user', () => {
        const proposal = buildVaultProposal('save_key', { name: 'GA', kind: 'google', env: [{ name: 'GA_PROPERTY_ID', value: '123456' }] }, keys, devices);
        expect(proposal).toMatchObject({ action: 'add', missing: ['GOOGLE_SERVICE_ACCOUNT'], key: { kind: 'google', slug: 'ga', allow: ['happy ga data *', 'happy ga admin get *'] } });
    });

    it('drafts a Facebook sign-in key, asking for the secret and leaving out the optional client token', () => {
        const proposal = buildVaultProposal('save_key', { name: 'Facebook', kind: 'facebook-login', env: [{ name: 'FACEBOOK_APP_ID', value: '1234567890' }] }, keys, devices);
        expect(proposal).toMatchObject({ action: 'add', missing: ['FACEBOOK_APP_SECRET'], key: { kind: 'facebook-login', allow: ['happy oauth check'] } });
        if (proposal.action !== 'add') return;
        expect(proposal.key.env.map((v) => v.name)).toEqual(['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']);
    });

    it('drafts a server login and asks for its password when the agent has none', () => {
        const proposal = buildVaultProposal('save_key', { name: 'staging', ssh: { host: '10.0.0.5', user: 'root' }, devices: ['mac mini'] }, keys, devices);
        expect(proposal).toMatchObject({
            action: 'add', missing: ['ssh'],
            key: { kind: 'ssh', allow: ['*'], machineIds: ['mini'], ssh: { host: '10.0.0.5', user: 'root', port: 22, auth: 'password', secret: '', viaMachineId: 'mini' } },
        });
    });

    it('changes only what the agent lists and keeps every secret it left out', () => {
        const proposal = buildVaultProposal('save_key', { key: 'github', allow: ['git push *', 'gh pr merge *'], devices: ['admin', 'coder wfs'] }, keys, devices);
        expect(proposal.action).toBe('edit');
        if (proposal.action !== 'edit') return;
        expect(proposal.previous).toBe(github);
        expect(proposal.key).toMatchObject({ id: 'gh', env: github.env, deny: github.deny, allow: ['git push *', 'gh pr merge *'], machineIds: ['admin', 'wfs'] });
        expect(proposal.missing).toEqual([]);
    });

    it('adds, replaces and drops variables on an existing key', () => {
        const custom: VaultKey = { ...github, id: 'c', slug: 'mail', kind: 'custom', name: 'Mail', env: [{ name: 'A', value: '1', secret: false }, { name: 'B', value: 'old', secret: true }], allow: [], deny: [] };
        const proposal = buildVaultProposal('save_key', { key: 'mail', env: [{ name: 'B', value: 'new' }, { name: 'C', value: 'x', secret: false }], removeEnv: ['A'] }, [custom], devices);
        expect(proposal).toMatchObject({ action: 'edit', key: { env: [{ name: 'B', value: 'new', secret: true }, { name: 'C', value: 'x', secret: false }] } });
    });

    it('moves a server login to the devices the agent names, keeping its password', () => {
        const proposal = buildVaultProposal('save_key', { key: 'vm-node05', devices: ['coder wfs', 'admin'] }, keys, devices);
        expect(proposal).toMatchObject({ action: 'edit', key: { machineIds: ['wfs', 'admin'], ssh: { secret: 'PW', viaMachineId: 'wfs' } } });
    });

    it('finds a key by its display name too', () => {
        expect(buildVaultProposal('delete_key', { key: 'GitHub' }, keys, devices)).toEqual({ action: 'delete', previous: github });
        expect(buildVaultProposal('delete_key', { key: 'npm' }, keys, devices)).toEqual({ action: 'gone', name: 'npm' });
        expect(buildVaultProposal('save_key', { key: 'npm', allow: [] }, keys, devices)).toEqual({ action: 'gone', name: 'npm' });
    });

    it('turns down drafts that cannot be saved, saying why', () => {
        expect(buildVaultProposal('save_key', { env: [{ name: 'X', value: '1' }] }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'name' } });
        expect(buildVaultProposal('save_key', { name: 'Other', slug: 'github', env: [{ name: 'X', value: '1' }] }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'slugTaken', slug: 'github' } });
        expect(buildVaultProposal('save_key', { name: 'Other', slug: 'Bad Slug!', env: [{ name: 'X', value: '1' }] }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'slugInvalid' } });
        expect(buildVaultProposal('save_key', { name: 'Other', env: [{ name: 'X', value: '1' }], devices: ['laptop'] }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'device', name: 'laptop' } });
        expect(buildVaultProposal('save_key', { name: 'Other', env: [{ name: 'bad-name', value: '1' }] }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'input' } });
        expect(buildVaultProposal('save_key', { name: 'Empty' }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'input' } });
        expect(buildVaultProposal('save_key', { name: 'Server', kind: 'ssh' }, keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'login' } });
        expect(buildVaultProposal('save_key', { name: 'X', env: [{ name: 'X', value: '1' }] }, keys, [])).toEqual({ action: 'invalid', problem: { kind: 'devices' } });
        expect(buildVaultProposal('save_key', 'not an object', keys, devices)).toEqual({ action: 'invalid', problem: { kind: 'input' } });
    });

    it('keeps the slug of a key it renames, and lets a renamed key keep its own slug', () => {
        expect(buildVaultProposal('save_key', { key: 'github', name: 'GitHub (work)' }, keys, devices)).toMatchObject({ action: 'edit', key: { slug: 'github', name: 'GitHub (work)' } });
        expect(buildVaultProposal('save_key', { key: 'github', slug: 'github' }, keys, devices)).toMatchObject({ action: 'edit' });
    });
});

describe('vaultKeyUnchanged', () => {
    it('sees a draft that is already saved as no change, whatever device comes first', () => {
        const proposal = buildVaultProposal('save_key', { key: 'github', allow: ['git push *'] }, keys, devices);
        expect(proposal.action === 'edit' && vaultKeyUnchanged(proposal.key, proposal.previous)).toBe(true);
        const moved = buildVaultProposal('save_key', { key: 'vm-node05', devices: ['admin'] }, keys, devices);
        expect(moved.action === 'edit' && vaultKeyUnchanged(moved.key, moved.previous)).toBe(true);
        const changed = buildVaultProposal('save_key', { key: 'github', env: [{ name: 'GH_TOKEN', value: 'ghp_NEW' }] }, keys, devices);
        expect(changed.action === 'edit' && vaultKeyUnchanged(changed.key, changed.previous)).toBe(false);
    });
});
