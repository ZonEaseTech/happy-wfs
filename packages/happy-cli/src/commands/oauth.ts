import { createSign } from 'node:crypto'
import { vaultNormalizePem } from 'happy-wire'

/**
 * `happy oauth check`: whether a "continue with Google / Apple / Facebook" key's credentials work.
 * It runs under `happy run <key> --`, which injects the key's variables, and asks each provider
 * the cheapest question only correct credentials get past. It prints no token: a Facebook app
 * token, for one, is as good as the app secret.
 */
export const OAUTH_USAGE = `Usage, always through a Google, Apple or Facebook login key from the resource center:
  happy run <key> -- happy oauth check
      checks the key's sign-in credentials with the provider; prints no token`

export type OauthCheck = { label: string; ok: boolean; detail: string }

/** A code Google never issued: Google checks the client before the code, so its error says which one failed. */
const PROBE_CODE = 'happy-oauth-check'

const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
})

/** Google answers invalid_grant to a known client with a made-up code, and invalid_client to anything else. */
async function probeGoogle(fields: Record<string, string>, fetchImpl: typeof fetch): Promise<{ ok: boolean; detail: string }> {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', form({ ...fields, code: PROBE_CODE, grant_type: 'authorization_code' }))
    const body = await response.json().catch(() => ({})) as { error?: string; error_description?: string }
    return body.error === 'invalid_grant'
        ? { ok: true, detail: 'credentials accepted' }
        : { ok: false, detail: [body.error ?? `HTTP ${response.status}`, body.error_description].filter(Boolean).join(': ') }
}

/**
 * Apple looks at an authorization code before the client, so a made-up code proves nothing. Its
 * client-credentials grant (the one team transfers use) authenticates the client first instead:
 * any wrong Team ID, Key ID, .p8 or ID comes back invalid_client. The token it may hand out is not shown.
 */
async function probeApple(clientId: string, clientSecret: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; detail: string }> {
    const response = await fetchImpl('https://appleid.apple.com/auth/token', form({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: 'user.migration' }))
    const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
    if (body.access_token) return { ok: true, detail: 'credentials accepted' }
    if (body.error === 'invalid_client') return { ok: false, detail: 'invalid_client: Apple does not accept this Team ID, Key ID and .p8 for this ID' }
    return { ok: !!body.error, detail: body.error ? `client accepted (Apple answered ${body.error} to the probe itself)` : `HTTP ${response.status}` }
}

/** Sign in with Apple's client secret: an ES256 JWT signed with the .p8 key, short-lived since it is only a probe. */
export function appleClientSecret(env: NodeJS.ProcessEnv, clientId: string, now = Math.floor(Date.now() / 1000)): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${encode({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: clientId })}`
    const signature = createSign('SHA256').update(unsigned).sign({ key: vaultNormalizePem(env.APPLE_PRIVATE_KEY!), dsaEncoding: 'ieee-p1363' }, 'base64url')
    return `${unsigned}.${signature}`
}

export async function checkOauth(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<OauthCheck[]> {
    const checks: OauthCheck[] = []
    if (env.GOOGLE_CLIENT_ID) {
        const label = `Google    client ${env.GOOGLE_CLIENT_ID}`
        checks.push(env.GOOGLE_CLIENT_SECRET
            ? { label, ...(await probeGoogle({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: 'https://localhost' }, fetchImpl)) }
            : { label, ok: false, detail: 'GOOGLE_CLIENT_SECRET is missing' })
    }
    if (env.APPLE_TEAM_ID || env.APPLE_KEY_ID || env.APPLE_PRIVATE_KEY) {
        const missing = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'].filter((name) => !env[name])
        const clients = [['Services ID', env.APPLE_SERVICES_ID], ['Bundle ID', env.APPLE_BUNDLE_ID]].filter((entry): entry is [string, string] => !!entry[1])
        if (missing.length || clients.length === 0) {
            checks.push({ label: 'Apple', ok: false, detail: `${[...missing, ...(clients.length ? [] : ['APPLE_SERVICES_ID or APPLE_BUNDLE_ID'])].join(', ')} missing` })
        }
        for (const [kind, clientId] of missing.length ? [] : clients) {
            const label = `Apple     ${kind} ${clientId}, team ${env.APPLE_TEAM_ID}, key ${env.APPLE_KEY_ID}`
            try {
                checks.push({ label, ...(await probeApple(clientId, appleClientSecret(env, clientId), fetchImpl)) })
            } catch (error) {
                checks.push({ label, ok: false, detail: `the .p8 key could not sign: ${error instanceof Error ? error.message : String(error)}` })
            }
        }
    }
    if (env.FACEBOOK_APP_ID) {
        const label = `Facebook  app ${env.FACEBOOK_APP_ID}`
        if (!env.FACEBOOK_APP_SECRET) {
            checks.push({ label, ok: false, detail: 'FACEBOOK_APP_SECRET is missing' })
        } else {
            const query = new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, grant_type: 'client_credentials' })
            const response = await fetchImpl(`https://graph.facebook.com/oauth/access_token?${query}`)
            const body = await response.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } }
            if (!body.access_token) {
                checks.push({ label, ok: false, detail: body.error?.message ?? `HTTP ${response.status}` })
            } else {
                const app = await fetchImpl(`https://graph.facebook.com/${encodeURIComponent(env.FACEBOOK_APP_ID)}?${new URLSearchParams({ fields: 'name', access_token: body.access_token })}`)
                const name = (await app.json().catch(() => ({})) as { name?: string }).name
                checks.push({ label: name ? `${label} ("${name}")` : label, ok: true, detail: `app secret accepted${env.FACEBOOK_CLIENT_TOKEN ? '; the client token is stored but only Facebook\'s SDKs can use it, so it is not checked here' : ''}` })
            }
        }
    }
    if (checks.length === 0) throw new Error(`No Google, Apple or Facebook sign-in credentials in the environment.\n${OAUTH_USAGE}`)
    return checks
}

export async function handleOauthCommand(args: string[]): Promise<number> {
    if (args[0] !== 'check' || args.length !== 1) {
        console.log(OAUTH_USAGE)
        return args.length === 0 || args[0] === 'help' || args[0] === '--help' ? 0 : 1
    }
    const checks = await checkOauth(process.env)
    console.log(checks.map((check) => `${check.label}  ${check.ok ? 'ok' : 'failed'}: ${check.detail}`).join('\n'))
    return checks.every((check) => check.ok) ? 0 : 1
}
