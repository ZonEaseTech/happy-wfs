/**
 * Decrypt one server-returned message envelope using a previously-resolved
 * session encryption key (from `decryptSessionRow`).
 *
 * Server returns `content` either as a raw base64 string or as a `{ t: 'encrypted', c: 'base64' }` wrapper. Both shapes carry the same encrypted bytes — the
 * wrapper is just transport metadata. We unwrap then decrypt.
 */

import { decodeBase64, decryptWithDataKey, decryptLegacy } from '@/api/encryption';

interface RawMessage {
    id: string;
    seq: number;
    content: unknown;
    localId: string | null;
    sentBy: string | null;
    sentByName: string | null;
    deliveryIssue?: { status: string; reason: string | null } | null;
    createdAt: number;
    updatedAt: number;
}

interface DecryptedAgentContent {
    type: 'output';
    data: unknown;
}

interface DecryptedUserContent {
    type: 'text' | 'mixed';
    text: string;
    images?: Array<Record<string, any>>;
}

export interface DecryptedMessage {
    id: string;
    seq: number;
    role: 'user' | 'agent' | 'unknown';
    content: DecryptedUserContent | DecryptedAgentContent | null;
    /** Convenience: a string preview of the message body for cards/inspect. */
    textPreview: string;
    sentBy: string | null;
    sentByName: string | null;
    createdAt: number;
    updatedAt: number;
    deliveryIssue?: { status: string; reason: string | null } | null;
}

function extractEncryptedBase64(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (
        content &&
        typeof content === 'object' &&
        (content as any).t === 'encrypted' &&
        typeof (content as any).c === 'string'
    ) {
        return (content as any).c;
    }
    return null;
}

function buildPreview(content: any): string {
    if (!content) return '';
    if (content.type === 'text' && typeof content.text === 'string') {
        return content.text;
    }
    if (content.type === 'mixed' && typeof content.text === 'string') {
        return content.text;
    }
    if (content.type === 'output') {
        const data = content.data;
        if (typeof data === 'string') return data;
        // Agent output is varied (claude/codex/gemini ACP); cheaply look for known shapes.
        if (data && typeof data === 'object') {
            if (data.type === 'message' && typeof data.message === 'string') return data.message;
            if (data.type === 'reasoning' && typeof data.message === 'string') return data.message;
            if (typeof data.text === 'string') return data.text;
        }
    }
    return '';
}

export function decryptMessage(
    raw: RawMessage,
    encryptionKey: Uint8Array,
    encryptionVariant: 'legacy' | 'dataKey',
): DecryptedMessage {
    const base64 = extractEncryptedBase64(raw.content);
    let decrypted: any = null;
    if (base64) {
        try {
            const bytes = decodeBase64(base64);
            decrypted = encryptionVariant === 'legacy'
                ? decryptLegacy(bytes, encryptionKey)
                : decryptWithDataKey(bytes, encryptionKey);
        } catch {
            decrypted = null;
        }
    }

    const role = decrypted?.role === 'user' || decrypted?.role === 'agent'
        ? decrypted.role
        : 'unknown';
    const content = decrypted?.content ?? null;

    return {
        id: raw.id,
        seq: raw.seq,
        role,
        content,
        textPreview: buildPreview(content),
        sentBy: raw.sentBy,
        sentByName: raw.sentByName,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        deliveryIssue: raw.deliveryIssue ?? undefined,
    };
}
