import { readFileSync } from 'node:fs'
import { connect } from 'node:tls'
import nodemailer from 'nodemailer'

/**
 * `happy mail`: mail through an email key from the resource center. It runs under
 * `happy run <key> --`, which puts the account in the environment (MAIL_ADDRESS, MAIL_PASSWORD,
 * SMTP_HOST/PORT, IMAP_HOST/PORT), checks the command against the key's rules and masks the
 * password in the output, so the agent asking for it never sees the password.
 */
const USAGE = `Usage, always through an email key from the resource center:
  happy run <key> -- happy mail check
      log in to SMTP and IMAP, send nothing
  happy run <key> -- happy mail send --to <address>[,<address>] --subject <text> (--body <text> | --body-file <path>)
      send one plain-text mail from the key's address`

export type MailAccount = { address: string; password: string; smtpHost: string; smtpPort: number; imapHost: string | null; imapPort: number }
export type MailCommand =
    | { command: 'check' }
    | { command: 'send'; to: string[]; subject: string; body: string | null; bodyFile: string | null }

export function mailAccountFromEnv(env: NodeJS.ProcessEnv): MailAccount {
    const missing = ['MAIL_ADDRESS', 'MAIL_PASSWORD', 'SMTP_HOST'].filter((name) => !env[name])
    if (missing.length) throw new Error(`${missing.join(', ')} not set. Run it through an email key: happy run <key> -- happy mail ...`)
    return {
        address: env.MAIL_ADDRESS!,
        password: env.MAIL_PASSWORD!,
        smtpHost: env.SMTP_HOST!,
        smtpPort: Number(env.SMTP_PORT || 465),
        imapHost: env.IMAP_HOST || null,
        imapPort: Number(env.IMAP_PORT || 993),
    }
}

/** `check`, or `send` with --to (repeatable or comma separated), --subject and --body / --body-file. */
export function parseMailArgs(args: string[]): MailCommand {
    if (args[0] === 'check' && args.length === 1) return { command: 'check' }
    if (args[0] !== 'send') throw new Error(USAGE)
    const flags: Record<string, string[]> = {}
    for (let i = 1; i < args.length; i += 2) {
        const [name, value] = [args[i], args[i + 1]]
        if (!['--to', '--subject', '--body', '--body-file'].includes(name) || value === undefined) throw new Error(USAGE)
        flags[name] = [...(flags[name] ?? []), value]
    }
    const to = (flags['--to'] ?? []).flatMap((value) => value.split(',')).map((address) => address.trim()).filter(Boolean)
    const [subject, body, bodyFile] = [flags['--subject']?.[0], flags['--body']?.[0] ?? null, flags['--body-file']?.[0] ?? null]
    if (to.length === 0 || subject === undefined || (body === null) === (bodyFile === null)) throw new Error(USAGE)
    return { command: 'send', to, subject, body, bodyFile }
}

/** Port 465 is TLS from the first byte; 25, 587 and 2525 upgrade with STARTTLS, which is required so the password never goes out in clear. */
function smtpTransport(account: MailAccount) {
    const startTls = [25, 587, 2525].includes(account.smtpPort)
    return nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: !startTls,
        requireTLS: startTls,
        auth: { user: account.address, pass: account.password },
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
    })
}

/** IMAP over TLS: LOGIN, then LOGOUT. Rejects with the server's own answer when the login is refused. */
export function imapLogin(account: MailAccount): Promise<void> {
    const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`
    return new Promise((resolve, reject) => {
        const socket = connect({ host: account.imapHost!, port: account.imapPort, servername: account.imapHost!, timeout: 20_000 })
        let buffer = ''
        socket.setEncoding('utf8')
        socket.on('timeout', () => socket.destroy(new Error('timed out')))
        socket.on('error', reject)
        socket.on('close', () => reject(new Error('connection closed before the login finished')))
        socket.on('data', (chunk: string) => {
            buffer += chunk
            for (let end = buffer.indexOf('\r\n'); end !== -1; end = buffer.indexOf('\r\n')) {
                const line = buffer.slice(0, end)
                buffer = buffer.slice(end + 2)
                if (/^\* (OK|PREAUTH)/i.test(line)) socket.write(`a1 LOGIN ${quote(account.address)} ${quote(account.password)}\r\n`)
                if (/^\* BYE/i.test(line) || /^a1 (NO|BAD)/i.test(line)) socket.destroy(new Error(line.replace(/^(\*|a1) /, '')))
                if (/^a1 OK/i.test(line)) {
                    resolve()
                    socket.end('a2 LOGOUT\r\n')
                }
            }
        })
    })
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function handleMailCommand(args: string[]): Promise<number> {
    const parsed = parseMailArgs(args)
    const account = mailAccountFromEnv(process.env)

    if (parsed.command === 'check') {
        const results = await Promise.allSettled([
            smtpTransport(account).verify(),
            account.imapHost ? imapLogin(account) : Promise.resolve(),
        ])
        const lines = [
            `SMTP ${account.smtpHost}:${account.smtpPort}  ${results[0].status === 'fulfilled' ? `login ok as ${account.address}` : `failed: ${message(results[0].reason)}`}`,
            account.imapHost
                ? `IMAP ${account.imapHost}:${account.imapPort}  ${results[1].status === 'fulfilled' ? `login ok as ${account.address}` : `failed: ${message(results[1].reason)}`}`
                : 'IMAP  not set on this key',
        ]
        console.log(lines.join('\n'))
        return results.every((result) => result.status === 'fulfilled') ? 0 : 1
    }

    const text = parsed.body ?? readFileSync(parsed.bodyFile!, 'utf8')
    const info = await smtpTransport(account).sendMail({ from: account.address, to: parsed.to, subject: parsed.subject, text })
    const rejected = info.rejected.map((entry) => (typeof entry === 'string' ? entry : entry.address))
    console.log(`sent from ${account.address} to ${parsed.to.join(', ')}${rejected.length ? `; refused by the server: ${rejected.join(', ')}` : ''} (message id ${info.messageId})`)
    return rejected.length ? 1 : 0
}
