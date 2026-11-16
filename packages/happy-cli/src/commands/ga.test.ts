import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GoogleServiceAccount } from 'happy-wire'
import { callGa, parseGaArgs, signedAssertion } from './ga'

const READ = 'https://www.googleapis.com/auth/analytics.readonly'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const account: GoogleServiceAccount = {
    clientEmail: 'ga-reader@demo-proj.iam.gserviceaccount.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    privateKeyId: 'kid-1',
    projectId: 'demo-proj',
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())

describe('parseGaArgs', () => {
    it('sends Data API methods to the property, defaulting to the key\'s', () => {
        expect(parseGaArgs(['data', 'runReport', '--body', '{"metrics":[{"name":"activeUsers"}]}'], { GA_PROPERTY_ID: '123' })).toEqual({
            method: 'POST', url: 'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport', body: { metrics: [{ name: 'activeUsers' }] }, scope: READ,
        })
        expect(parseGaArgs(['data', 'getMetadata', '--property', '456'], { GA_PROPERTY_ID: '123' })).toEqual({
            method: 'GET', url: 'https://analyticsdata.googleapis.com/v1beta/properties/456/metadata', scope: READ,
        })
        expect(parseGaArgs(['data', 'runRealtimeReport', '--body-file', '/tmp/q.json'], { GA_PROPERTY_ID: '123' }, () => '{"limit":5}')).toMatchObject({ body: { limit: 5 } })
        expect(() => parseGaArgs(['data', 'runReport'], {})).toThrow(/Which property/)
    })

    it('keeps settings reads and changes apart, changes with the edit scope', () => {
        expect(parseGaArgs(['admin', 'get', 'accountSummaries'], {})).toEqual({ method: 'GET', url: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries', scope: READ })
        expect(parseGaArgs(['admin', 'get', 'v1alpha/properties/123/channelGroups'], {})).toMatchObject({ url: 'https://analyticsadmin.googleapis.com/v1alpha/properties/123/channelGroups' })
        const change = parseGaArgs(['admin', 'change', 'patch', 'properties/123?updateMask=displayName', '--body', '{"displayName":"Shop"}'], {})
        expect(change).toMatchObject({ method: 'PATCH', url: 'https://analyticsadmin.googleapis.com/v1beta/properties/123?updateMask=displayName', body: { displayName: 'Shop' } })
        expect(change.scope).toContain('analytics.edit')
    })

    it('refuses anything that is not one well-formed call', () => {
        for (const args of [
            [], ['data'], ['data', 'run-report'], ['admin', 'get'], ['admin', 'get', 'https://evil.example/x'], ['admin', 'get', 'properties/../../x'],
            ['admin', 'get', 'accountSummaries', '--body', '{}'], ['admin', 'change', 'GET', 'properties/1'], ['admin', 'delete', 'properties/1'],
            ['data', 'runReport', '--property', '1', '--body', '{}', '--body-file', 'f'], ['data', 'runReport', '--property', '1', '--format', 'csv'],
        ]) {
            expect(() => parseGaArgs(args, {})).toThrow()
        }
        expect(() => parseGaArgs(['data', 'runReport', '--property', '1', '--body', '{oops'], {})).toThrow(/not valid JSON/)
    })
})

describe('signedAssertion', () => {
    it('is a JWT for Google\'s token endpoint, signed with the service account key', () => {
        const [header, payload, signature] = signedAssertion(account, READ, 1_800_000_000).split('.')
        expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' })
        expect(decode(payload)).toEqual({ iss: account.clientEmail, scope: READ, aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600 })
        expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url')).toBe(true)
    })
})

describe('callGa', () => {
    it('trades the assertion for a token, then calls the API with it', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = []
        const fakeFetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, init })
            return calls.length === 1
                ? new Response(JSON.stringify({ access_token: 'ya29.token', expires_in: 3599 }), { status: 200 })
                : new Response('{"rows":[]}', { status: 200 })
        }) as unknown as typeof fetch
        const result = await callGa({ method: 'POST', url: 'https://analyticsdata.googleapis.com/v1beta/properties/1:runReport', body: { limit: 1 }, scope: READ }, account, fakeFetch)
        expect(result).toEqual({ status: 200, text: '{"rows":[]}' })
        expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
        const form = new URLSearchParams(String(calls[0].init.body))
        expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
        expect(decode(form.get('assertion')!.split('.')[1]).iss).toBe(account.clientEmail)
        expect(calls[1]).toMatchObject({ url: 'https://analyticsdata.googleapis.com/v1beta/properties/1:runReport', init: { method: 'POST', body: '{"limit":1}' } })
        expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer ya29.token')
    })

    it('says which service account Google turned down, and why', async () => {
        const fakeFetch = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })) as unknown as typeof fetch
        await expect(callGa({ method: 'GET', url: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries', scope: READ }, account, fakeFetch))
            .rejects.toThrow('Google did not accept the service account ga-reader@demo-proj.iam.gserviceaccount.com: Invalid JWT Signature.')
    })
})
