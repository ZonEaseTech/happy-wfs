import { describe, expect, it } from 'vitest'
import { mailAccountFromEnv, parseMailArgs } from './mail'

describe('parseMailArgs', () => {
    it('takes check alone', () => {
        expect(parseMailArgs(['check'])).toEqual({ command: 'check' })
        expect(() => parseMailArgs(['check', 'extra'])).toThrow(/Usage/)
    })

    it('reads send with repeated or comma separated recipients', () => {
        expect(parseMailArgs(['send', '--to', 'a@x.com, b@x.com', '--to', 'c@x.com', '--subject', '你好', '--body', 'line one\nline two'])).toEqual({
            command: 'send', to: ['a@x.com', 'b@x.com', 'c@x.com'], subject: '你好', body: 'line one\nline two', bodyFile: null,
        })
        expect(parseMailArgs(['send', '--to', 'a@x.com', '--subject', '', '--body-file', '/tmp/body.txt'])).toMatchObject({ subject: '', body: null, bodyFile: '/tmp/body.txt' })
    })

    it('refuses a send it cannot carry out as written', () => {
        expect(() => parseMailArgs(['send', '--subject', 's', '--body', 'b'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['send', '--to', 'a@x.com', '--body', 'b'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['send', '--to', 'a@x.com', '--subject', 's'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['send', '--to', 'a@x.com', '--subject', 's', '--body', 'b', '--body-file', 'f'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['send', '--to', 'a@x.com', '--subject', 's', '--body', 'b', '--cc', 'c@x.com'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['send', '--to'])).toThrow(/Usage/)
        expect(() => parseMailArgs(['inbox'])).toThrow(/Usage/)
    })
})

describe('mailAccountFromEnv', () => {
    it('reads the account an email key injects, with the usual ports by default', () => {
        expect(mailAccountFromEnv({ MAIL_ADDRESS: 'me@x.com', MAIL_PASSWORD: 'pw', SMTP_HOST: 'smtp.x.com', IMAP_HOST: 'imap.x.com' })).toEqual({
            address: 'me@x.com', password: 'pw', smtpHost: 'smtp.x.com', smtpPort: 465, imapHost: 'imap.x.com', imapPort: 993,
        })
        expect(mailAccountFromEnv({ MAIL_ADDRESS: 'me@x.com', MAIL_PASSWORD: 'pw', SMTP_HOST: 'smtp.x.com', SMTP_PORT: '587' })).toMatchObject({ smtpPort: 587, imapHost: null })
    })

    it('says to go through a key when run on its own', () => {
        expect(() => mailAccountFromEnv({})).toThrow(/MAIL_ADDRESS, MAIL_PASSWORD, SMTP_HOST not set.*happy run <key>/)
    })
})
