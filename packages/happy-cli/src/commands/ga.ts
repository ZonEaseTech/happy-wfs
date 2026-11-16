import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseGoogleServiceAccount, type GoogleServiceAccount } from 'happy-wire'

/**
 * `happy ga`: Google Analytics through a Google service account key from the resource center.
 * It runs under `happy run <key> --`, which writes the service account's JSON key to a private
 * file named by GOOGLE_APPLICATION_CREDENTIALS, checks the command against the key's rules and
 * masks the key in the output. Reads and settings changes are separate subcommands so the key's
 * rules can allow one without the other.
 */
export const GA_USAGE = `Usage, always through a Google service account key from the resource center:
  happy run <key> -- happy ga data <method> [--property <id>] [--body <json> | --body-file <path>]
      Google Analytics Data API, read only: runReport, runRealtimeReport, batchRunReports,
      runPivotReport, checkCompatibility, getMetadata. --property defaults to the key's GA_PROPERTY_ID.
  happy run <key> -- happy ga admin get <path>
      Admin API reads, e.g. accountSummaries, properties/<id>, properties/<id>/dataStreams
  happy run <key> -- happy ga admin change <POST|PATCH|DELETE> <path> [--body <json> | --body-file <path>]
      Admin API changes, only if the key allows them. Put ?updateMask=... in the path for PATCH.
Paths are relative to v1beta; start one with v1alpha/ for alpha-only resources. Request bodies
follow Google's REST reference for the Data and Admin APIs.`

const DATA_API = 'https://analyticsdata.googleapis.com/v1beta/'
const ADMIN_API = 'https://analyticsadmin.googleapis.com/'
/** Always Google's own endpoint, whatever token_uri the JSON names: the signed assertion goes nowhere else. */
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const READ_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const EDIT_SCOPE = 'https://www.googleapis.com/auth/analytics.edit https://www.googleapis.com/auth/analytics.manage.users'

export type GaRequest = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; body?: unknown; scope: string }

/** Relative API paths only: no URL of its own (`//`), no climbing out of the API with `..`. */
const PATH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9/_.:~%=&?,+-]*$/

/** The one REST call a `happy ga ...` command stands for. */
export function parseGaArgs(args: string[], env: NodeJS.ProcessEnv, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): GaRequest {
    const [area, verb, ...rest] = args
    const positional: string[] = []
    const flags: Record<string, string> = {}
    for (let i = 0; i < rest.length; i++) {
        if (!rest[i].startsWith('--')) { positional.push(rest[i]); continue }
        if (!['--property', '--body', '--body-file'].includes(rest[i]) || rest[i + 1] === undefined || flags[rest[i]] !== undefined) throw new Error(GA_USAGE)
        flags[rest[i]] = rest[++i]
    }
    if (flags['--body'] !== undefined && flags['--body-file'] !== undefined) throw new Error(GA_USAGE)
    const rawBody = flags['--body'] ?? (flags['--body-file'] === undefined ? undefined : readFile(flags['--body-file']))
    let body: unknown
    try {
        body = rawBody === undefined ? undefined : JSON.parse(rawBody)
    } catch {
        throw new Error('The request body is not valid JSON.')
    }

    if (area === 'data' && verb && /^[A-Za-z]+$/.test(verb) && positional.length === 0) {
        const property = flags['--property'] ?? env.GA_PROPERTY_ID
        if (!property || !/^\d+$/.test(property)) throw new Error('Which property? Pass --property <numeric id>, or set GA_PROPERTY_ID on the key.')
        return verb === 'getMetadata'
            ? { method: 'GET', url: `${DATA_API}properties/${property}/metadata`, scope: READ_SCOPE }
            : { method: 'POST', url: `${DATA_API}properties/${property}:${verb}`, body: body ?? {}, scope: READ_SCOPE }
    }
    const adminUrl = (path: string | undefined) => {
        if (!path || !PATH.test(path)) throw new Error(`Not an Admin API path: ${path ?? '(none)'}\n${GA_USAGE}`)
        return `${ADMIN_API}${/^v1(alpha|beta)\//.test(path) ? path : `v1beta/${path}`}`
    }
    if (area === 'admin' && verb === 'get' && positional.length === 1 && body === undefined && !flags['--property']) {
        return { method: 'GET', url: adminUrl(positional[0]), scope: READ_SCOPE }
    }
    const method = positional[0]?.toUpperCase()
    if (area === 'admin' && verb === 'change' && positional.length === 2 && (method === 'POST' || method === 'PATCH' || method === 'DELETE') && !flags['--property']) {
        return { method, url: adminUrl(positional[1]), body, scope: EDIT_SCOPE }
    }
    throw new Error(GA_USAGE)
}

/** The JWT-bearer grant (RFC 7523) for a service account, signed here with its private key. */
export function signedAssertion(account: GoogleServiceAccount, scope: string, now = Math.floor(Date.now() / 1000)): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const header = { alg: 'RS256', typ: 'JWT', ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) }
    const unsigned = `${encode(header)}.${encode({ iss: account.clientEmail, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`
    return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(account.privateKey, 'base64url')}`
}

/** Trades the assertion for an access token, then makes the call. */
export async function callGa(request: GaRequest, account: GoogleServiceAccount, fetchImpl: typeof fetch = fetch): Promise<{ status: number; text: string }> {
    const tokenResponse = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(account, request.scope) }).toString(),
    })
    const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
    if (!tokenResponse.ok || !token.access_token) {
        throw new Error(`Google did not accept the service account ${account.clientEmail}: ${token.error_description ?? token.error ?? `HTTP ${tokenResponse.status}`}`)
    }
    const response = await fetchImpl(request.url, {
        method: request.method,
        headers: { authorization: `Bearer ${token.access_token}`, ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
    })
    return { status: response.status, text: await response.text() }
}

export async function handleGaCommand(args: string[]): Promise<number> {
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
        console.log(GA_USAGE)
        return 0
    }
    const request = parseGaArgs(args, process.env)
    const file = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (!file) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set. Run it through a Google service account key: happy run <key> -- happy ga ...')
    const account = parseGoogleServiceAccount(readFileSync(file, 'utf8'))
    if (!account) throw new Error('GOOGLE_APPLICATION_CREDENTIALS does not point to a service account JSON key.')

    const { status, text } = await callGa(request, account)
    let pretty = text
    try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
        // not JSON: print as is
    }
    if (status >= 400) {
        console.error(`Google Analytics answered HTTP ${status}:\n${pretty}`)
        return 1
    }
    console.log(pretty || `HTTP ${status}`)
    return 0
}
