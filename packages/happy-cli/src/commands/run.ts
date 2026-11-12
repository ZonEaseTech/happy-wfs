import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { checkVaultCommand, createVaultMasker, vaultSecretsOf, type VaultDeviceCopy, type VaultUsageLog } from 'happy-wire'
import { readCredentials, readSettings } from '@/persistence'
import { fetchDeviceKeys, writeUsageLog } from '@/vault/store'

const USAGE = 'Usage: happy run <key> -- <command> [args...]   (list keys with: happy keys)'

/** `happy run <slug> -- <argv...>`. The `--` is required so flags always belong to the command. */
export function parseRunArgs(args: string[]): { slug: string; argv: string[] } {
    const separator = args.indexOf('--')
    const slug = args[0]
    const argv = separator === -1 ? [] : args.slice(separator + 1)
    if (!slug || slug === '--' || separator !== 1 || argv.length === 0) throw new Error(USAGE)
    return { slug, argv }
}

export type RunInvocation = { file: string; args: string[]; env: Record<string, string> }

/**
 * What actually gets spawned. Local keys run the command directly (no shell,
 * so the checked string is what runs); server logins hand the command to the
 * remote shell over ssh, with the password in SSHPASS (never in argv) or the
 * private key in a 0600 file the caller creates and removes.
 */
export function buildRunInvocation(key: VaultDeviceCopy, argv: string[], privateKeyFile: string | null): RunInvocation {
    if (!key.ssh) {
        return { file: argv[0], args: argv.slice(1), env: Object.fromEntries(key.env.map((v) => [v.name, v.value])) }
    }
    const { host, port, user, auth, secret } = key.ssh
    const target = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(port), `${user}@${host}`, argv.join(' ')]
    return auth === 'password'
        ? { file: 'sshpass', args: ['-e', 'ssh', ...target], env: { SSHPASS: secret } }
        : { file: 'ssh', args: ['-i', privateKeyFile ?? '', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', ...target], env: {} }
}

const DENIED: Record<string, string> = {
    guard: 'the command reads the secret or wraps a shell (sh -c, eval, env, printenv). Such commands never run with a key.',
    deny: 'it matches a rule in the key\'s deny list',
    'not-allowed': 'it is not on the key\'s allow list. Ask the user to add it in Happy (Resource center › the key › Allowed commands, or Usage log › Allow).',
}

/** Pipes a child stream to ours with the secrets masked, even when split across chunks. */
function pipeMasked(from: NodeJS.ReadableStream, to: NodeJS.WriteStream, secrets: string[]): Promise<void> {
    const decoder = new StringDecoder('utf8')
    const masker = createVaultMasker(secrets)
    from.on('data', (chunk: Buffer) => to.write(masker.push(decoder.write(chunk))))
    return new Promise((resolve) => from.on('end', () => {
        to.write(masker.flush() + decoder.end())
        resolve()
    }))
}

async function spawnMasked(invocation: RunInvocation, secrets: string[]): Promise<number> {
    const child = spawn(invocation.file, invocation.args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, ...invocation.env },
        shell: process.platform === 'win32',
    })
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal)
    process.on('SIGINT', forward('SIGINT'))
    process.on('SIGTERM', forward('SIGTERM'))
    const streams = Promise.all([pipeMasked(child.stdout!, process.stdout, secrets), pipeMasked(child.stderr!, process.stderr, secrets)])
    const exit = await new Promise<number>((resolve) => {
        child.on('error', (error) => {
            process.stderr.write(`happy: could not start ${invocation.file}: ${error.message}\n`)
            resolve(127)
        })
        child.on('close', (code, signal) => resolve(code ?? 128 + (signal ? osConstants.signals[signal] ?? 0 : 1)))
    })
    await streams
    return exit
}

export async function handleRunCommand(args: string[]): Promise<number> {
    const { slug, argv } = parseRunArgs(args)
    const credentials = await readCredentials()
    const { machineId } = await readSettings()
    if (!credentials || !machineId) throw new Error('This machine is not signed in to Happy. Run "happy" once to set it up.')

    const key = (await fetchDeviceKeys(credentials, machineId)).find((k) => k.slug === slug)
    if (!key) {
        process.stderr.write(`happy: no key named "${slug}" on this device. Either the name is wrong (see "happy keys"), or the key is not enabled for this device in Happy (Resource center › the key › Devices).\n`)
        return 2
    }

    const command = argv.join(' ')
    const startedAt = Date.now()
    const entry = (fields: Pick<VaultUsageLog, 'outcome' | 'reason' | 'rule' | 'exitCode' | 'durationMs'>): VaultUsageLog => ({
        v: 1, at: startedAt, keyId: key.id, slug, keyName: key.name, machineId,
        sessionId: process.env.HAPPY_SESSION_ID || null, cwd: process.cwd(), command, ...fields,
    })

    const check = checkVaultCommand(key, command)
    if (!check.allowed) {
        process.stderr.write(`happy: did not run, and the key was not unlocked: ${DENIED[check.reason]}\n`)
        await writeUsageLog(credentials, entry({ outcome: 'denied', reason: check.reason, rule: check.rule, exitCode: null, durationMs: null }))
        return 126
    }

    if (key.ssh?.auth === 'password' && spawnSync('sshpass', ['-V']).error) {
        throw new Error('sshpass is not installed on this machine (apt install sshpass, or brew install hudochenkov/sshpass/sshpass). A key with a private key instead of a password does not need it.')
    }
    const keyDir = key.ssh?.auth === 'key' ? mkdtempSync(join(tmpdir(), 'happy-run-')) : null
    const keyFile = keyDir ? join(keyDir, 'id') : null
    try {
        if (keyFile) writeFileSync(keyFile, key.ssh!.secret.endsWith('\n') ? key.ssh!.secret : `${key.ssh!.secret}\n`, { mode: 0o600 })
        const exitCode = await spawnMasked(buildRunInvocation(key, argv, keyFile), vaultSecretsOf(key))
        await writeUsageLog(credentials, entry({ outcome: exitCode === 0 ? 'ok' : 'failed', reason: null, rule: check.rule, exitCode, durationMs: Date.now() - startedAt }))
        return exitCode
    } finally {
        if (keyDir) rmSync(keyDir, { recursive: true, force: true })
    }
}
