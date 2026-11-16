import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { appleClientSecret, checkOauth } from './oauth'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

/** Answers each URL with the given JSON, recording what was asked. */
function fakeFetch(answers: Array<[RegExp, number, object]>) {
    const calls: Array<{ url: string; body: string }> = []
    const impl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, body: String(init?.body ?? '') })
        const [, status, json] = answers.find(([pattern]) => pattern.test(url))!
        return new Response(JSON.stringify(json), { status })
    }) as unknown as typeof fetch
    return { impl, calls }
}

describe('appleClientSecret', () => {
    it('is an ES256 JWT for appleid.apple.com that the .p8 key\'s public half verifies, even when the key lost its line breaks', () => {
        const env = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: p8.replace(/\n/g, '') }
        const [header, payload, signature] = appleClientSecret(env, 'com.example.web', 1_800_000_000).split('.')
        expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
        expect(decode(payload)).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'com.example.web' })
        expect(createVerify('SHA256').update(`${header}.${payload}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, signature, 'base64url')).toBe(true)
    })
})

describe('checkOauth', () => {
    it('takes Google\'s "bad code" as a client that works, and its "bad client" as one that does not', async () => {
        const good = fakeFetch([[/googleapis/, 400, { error: 'invalid_grant', error_description: 'Malformed auth code.' }]])
        const checks = await checkOauth({ GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-secret' }, good.impl)
        expect(checks).toEqual([{ label: 'Google    client web.apps.googleusercontent.com', ok: true, detail: 'credentials accepted' }])
        expect(new URLSearchParams(good.calls[0].body).get('client_secret')).toBe('GOCSPX-secret')
        const bad = fakeFetch([[/googleapis/, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' }]])
        expect((await checkOauth({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }, bad.impl))[0]).toMatchObject({ ok: false, detail: 'invalid_client: The OAuth client was not found.' })
    })

    it('checks each Apple ID with the client-credentials grant, which rejects any wrong key as invalid_client', async () => {
        const { impl, calls } = fakeFetch([[/appleid/, 400, { error: 'invalid_client' }]])
        const checks = await checkOauth({ APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_SERVICES_ID: 'com.example.web', APPLE_BUNDLE_ID: 'com.example.app', APPLE_PRIVATE_KEY: p8 }, impl)
        expect(checks.map((check) => check.ok)).toEqual([false, false])
        expect(checks[0].label).toContain('Services ID com.example.web')
        expect(checks[1].label).toContain('Bundle ID com.example.app')
        const sent = new URLSearchParams(calls[0].body)
        expect([sent.get('grant_type'), sent.get('scope'), sent.get('client_id')]).toEqual(['client_credentials', 'user.migration', 'com.example.web'])
        const ok = fakeFetch([[/appleid/, 200, { access_token: 'APPLE_TOKEN_VALUE', token_type: 'Bearer', expires_in: 3600 }]])
        const accepted = await checkOauth({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_SERVICES_ID: 'com.example.web', APPLE_PRIVATE_KEY: p8 }, ok.impl)
        expect(accepted[0]).toMatchObject({ ok: true, detail: 'credentials accepted' })
        expect(JSON.stringify(accepted)).not.toContain('APPLE_TOKEN_VALUE')
    })

    it('checks a Facebook app by its secret and names it, never printing the app token', async () => {
        const { impl } = fakeFetch([
            [/oauth\/access_token/, 200, { access_token: '123|APP_TOKEN_VALUE', token_type: 'bearer' }],
            [/graph\.facebook\.com\/123\?/, 200, { name: 'TTPOS', id: '123' }],
        ])
        const checks = await checkOauth({ FACEBOOK_APP_ID: '123', FACEBOOK_APP_SECRET: 'fb-secret', FACEBOOK_CLIENT_TOKEN: 'client-token' }, impl)
        expect(checks).toHaveLength(1)
        expect(checks[0]).toMatchObject({ label: 'Facebook  app 123 ("TTPOS")', ok: true })
        expect(JSON.stringify(checks)).not.toContain('APP_TOKEN_VALUE')
    })

    it('says what is missing instead of asking the provider', async () => {
        const { impl, calls } = fakeFetch([])
        const checks = await checkOauth({ GOOGLE_CLIENT_ID: 'id', APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: p8 }, impl)
        expect(checks.map((check) => check.detail)).toEqual(['GOOGLE_CLIENT_SECRET is missing', 'APPLE_SERVICES_ID or APPLE_BUNDLE_ID missing'])
        expect(calls).toHaveLength(0)
        await expect(checkOauth({}, impl)).rejects.toThrow(/No Google, Apple or Facebook sign-in credentials/)
    })

    it('reports a facebook secret the provider refused', async () => {
        const { impl } = fakeFetch([[/oauth\/access_token/, 400, { error: { message: 'Error validating client secret.' } }]])
        expect(await checkOauth({ FACEBOOK_APP_ID: '123', FACEBOOK_APP_SECRET: 'wrong' }, impl)).toEqual([{ label: 'Facebook  app 123', ok: false, detail: 'Error validating client secret.' }])
    })
})
