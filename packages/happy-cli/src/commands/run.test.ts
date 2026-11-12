import { describe, expect, it } from 'vitest'
import type { VaultDeviceCopy } from 'happy-wire'
import { buildRunInvocation, parseRunArgs } from './run'

const base = { v: 1 as const, id: 'k1', name: 'n', allow: ['*'], deny: [], scope: [], updatedAt: 0, machineId: 'm1' }
const cf: VaultDeviceCopy = {
    ...base, slug: 'cf-yyps', kind: 'cloudflare', ssh: null,
    env: [{ name: 'CLOUDFLARE_API_TOKEN', value: 'cfut_secret_value', secret: true }, { name: 'CLOUDFLARE_ACCOUNT_ID', value: 'acc', secret: false }],
}
const prod = (auth: 'password' | 'key'): VaultDeviceCopy => ({
    ...base, slug: 'vm-node05', kind: 'ssh', env: [],
    ssh: { host: '43.239.84.25', port: 22, user: 'dev', auth, secret: 'pw-or-key', viaMachineId: 'm1' },
})

describe('parseRunArgs', () => {
    it('takes the key name before -- and the command after it', () => {
        expect(parseRunArgs(['cf-yyps', '--', 'npx', 'wrangler', 'deploy', '--env', 'prod'])).toEqual({ slug: 'cf-yyps', argv: ['npx', 'wrangler', 'deploy', '--env', 'prod'] })
    })

    it('requires -- right after the name, and a command', () => {
        for (const args of [[], ['cf-yyps'], ['cf-yyps', 'npx', 'wrangler'], ['cf-yyps', '--'], ['--', 'ls'], ['cf-yyps', 'x', '--', 'ls']]) {
            expect(() => parseRunArgs(args)).toThrow(/Usage: happy run/)
        }
    })
})

describe('buildRunInvocation', () => {
    it('runs a local command directly with the key env injected', () => {
        expect(buildRunInvocation(cf, ['npx', 'wrangler', 'deploy'], null)).toEqual({
            file: 'npx', args: ['wrangler', 'deploy'],
            env: { CLOUDFLARE_API_TOKEN: 'cfut_secret_value', CLOUDFLARE_ACCOUNT_ID: 'acc' },
        })
    })

    it('logs in with sshpass and keeps the password out of argv', () => {
        const run = buildRunInvocation(prod('password'), ['sudo', 'docker', 'ps'], null)
        expect(run.file).toBe('sshpass')
        expect(run.env).toEqual({ SSHPASS: 'pw-or-key' })
        expect(run.args).toEqual(['-e', 'ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', '22', 'dev@43.239.84.25', 'sudo docker ps'])
        expect(run.args.join(' ')).not.toContain('pw-or-key')
    })

    it('logs in with a private key file when the key holds one', () => {
        const run = buildRunInvocation(prod('key'), ['uptime'], '/tmp/happy-run-x/id')
        expect(run).toEqual({
            file: 'ssh',
            args: ['-i', '/tmp/happy-run-x/id', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', '22', 'dev@43.239.84.25', 'uptime'],
            env: {},
        })
    })
})
