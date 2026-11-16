/**
 * nodemailer ships no type definitions. These cover only what `happy mail` (mail.ts) uses,
 * instead of pulling in @types/nodemailer for two calls.
 */
declare module 'nodemailer' {
    type Address = string | { name: string; address: string };

    export type SentMessageInfo = { messageId: string; accepted: Address[]; rejected: Address[]; response: string };

    export type Transporter = {
        verify(): Promise<true>;
        sendMail(mail: { from: string; to: string[]; subject: string; text: string }): Promise<SentMessageInfo>;
    };

    export function createTransport(options: {
        host: string;
        port: number;
        secure: boolean;
        requireTLS?: boolean;
        auth: { user: string; pass: string };
        connectionTimeout?: number;
        greetingTimeout?: number;
        socketTimeout?: number;
    }): Transporter;

    const nodemailer: { createTransport: typeof createTransport };
    export default nodemailer;
}
