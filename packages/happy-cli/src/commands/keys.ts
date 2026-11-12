import chalk from 'chalk'
import { readCredentials, readSettings } from '@/persistence'
import { fetchDeviceKeys } from '@/vault/store'

/**
 * `happy keys`: what this device may use, never the secrets themselves.
 * Agents read this before `happy run`, so it spells out the rules.
 */
export async function handleKeysCommand(): Promise<void> {
    const credentials = await readCredentials()
    const { machineId } = await readSettings()
    if (!credentials || !machineId) throw new Error('This machine is not signed in to Happy. Run "happy" once to set it up.')

    const keys = (await fetchDeviceKeys(credentials, machineId)).sort((a, b) => a.slug.localeCompare(b.slug))
    if (keys.length === 0) {
        console.log('No keys are enabled for this device. Add one in Happy: Resource center › Add key.')
        return
    }
    for (const key of keys) {
        const vars = key.ssh
            ? [`${key.ssh.user}@${key.ssh.host}:${key.ssh.port} (${key.ssh.auth === 'password' ? 'password' : 'private key'})`]
            : key.env.map((v) => (v.secret ? `${v.name} (secret)` : `${v.name}=${v.value}`))
        console.log(`${chalk.bold(key.slug)}  ${key.name}  ${chalk.gray(`[${key.kind}]`)}`)
        console.log(`  ${key.ssh ? 'login' : 'env  '}:  ${vars.join(', ') || '—'}`)
        console.log(`  allow:  ${key.allow.join('  |  ') || '— (nothing runs until the user adds a rule)'}`)
        console.log(`  deny:   ${key.deny.join('  |  ') || '—'}`)
        for (const scope of key.scope) console.log(`  scope:  ${scope.name}${scope.protected ? ` — do not touch: ${scope.protected}` : ''}`)
    }
    console.log(`\nUse a key: happy run <name> -- <command>. Commands that read the secret ($VAR, env, printenv, sh -c, eval) never run.`)
}
