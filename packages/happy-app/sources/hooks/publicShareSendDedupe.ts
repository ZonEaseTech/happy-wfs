import type { Message } from '@/sync/typesMessage';

export interface PublicShareAttachmentSignatureInput {
    name?: string | null;
    size?: number | null;
    mimeType?: string | null;
    uri?: string | null;
    width?: number | null;
    height?: number | null;
}

function normalizeAttachment(input: PublicShareAttachmentSignatureInput): string {
    return [
        input.name ?? '',
        input.size ?? '',
        input.mimeType ?? '',
        input.uri ?? '',
        input.width ?? '',
        input.height ?? '',
    ].join(':');
}

export function buildPublicShareSendSignature(
    text: string,
    images: PublicShareAttachmentSignatureInput[] = [],
    fileAttachments: PublicShareAttachmentSignatureInput[] = [],
): string {
    return JSON.stringify([
        text.trim(),
        images.map(normalizeAttachment),
        fileAttachments.map(normalizeAttachment),
    ]);
}

export function createPublicShareSendDeduper(windowMs: number) {
    const sentAtBySignature = new Map<string, number>();

    return {
        shouldSend(signature: string, now = Date.now()): boolean {
            const previous = sentAtBySignature.get(signature);
            if (previous !== undefined && now - previous < windowMs) {
                return false;
            }

            sentAtBySignature.set(signature, now);
            for (const [key, timestamp] of sentAtBySignature) {
                if (now - timestamp > windowMs * 2) {
                    sentAtBySignature.delete(key);
                }
            }
            return true;
        },
        forget(signature: string): void {
            sentAtBySignature.delete(signature);
        },
    };
}

function hashPublicShareSignature(signature: string): string {
    let hash = 2166136261;
    for (let i = 0; i < signature.length; i++) {
        hash ^= signature.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${(hash >>> 0).toString(36)}-${signature.length.toString(36)}`;
}

export function buildPublicShareLocalId(signature: string, now = Date.now(), windowMs = 60000): string {
    const bucket = Math.floor(now / windowMs).toString(36);
    return `public-share-${bucket}-${hashPublicShareSignature(signature)}`;
}

export function createPublicShareLocalIdCache(
    windowMs: number,
    createLocalId: (signature: string, now: number, windowMs: number) => string = buildPublicShareLocalId,
) {
    const localIdsBySignature = new Map<string, { localId: string; timestamp: number }>();

    function prune(now: number) {
        for (const [key, value] of localIdsBySignature) {
            if (now - value.timestamp > windowMs * 2) {
                localIdsBySignature.delete(key);
            }
        }
    }

    return {
        getOrCreate(signature: string, now = Date.now()): string {
            const previous = localIdsBySignature.get(signature);
            if (previous && now - previous.timestamp <= windowMs) {
                return previous.localId;
            }

            const localId = createLocalId(signature, now, windowMs);
            localIdsBySignature.set(signature, { localId, timestamp: now });
            prune(now);
            return localId;
        },
        forget(signature: string): void {
            localIdsBySignature.delete(signature);
        },
    };
}

export function createPublicShareStaleTextSubmitGuard() {
    let lastSubmittedText: string | null = null;

    return {
        markSubmitted(text: string): void {
            const trimmed = text.trim();
            lastSubmittedText = trimmed.length > 0 ? trimmed : null;
        },
        shouldBlock(text: string, draftIsEmpty: boolean): boolean {
            const trimmed = text.trim();
            return draftIsEmpty && trimmed.length > 0 && lastSubmittedText === trimmed;
        },
        clear(): void {
            lastSubmittedText = null;
        },
    };
}

function publicShareMessageDuplicateKey(message: Message): string | null {
    if (message.kind !== 'user-text') {
        return null;
    }
    if (message.meta?.sentFrom !== 'public-share') {
        return null;
    }

    const text = message.text.trim();
    const images = (message.images ?? [])
        .map(image => [
            image.url ?? '',
            image.mimeType ?? '',
            image.width ?? '',
            image.height ?? '',
        ].join(':'))
        .join('|');

    return [
        message.sentByName ?? '',
        text,
        images,
    ].join('\u001f');
}

function publicShareStableDisplayKey(message: Message): string | null {
    if (message.seq === undefined || message.seq === null) {
        return null;
    }

    if (message.kind === 'agent-text') {
        return [
            'seq',
            message.seq,
            message.kind,
            message.isThinking ? 'thinking' : 'text',
            message.text.trim(),
        ].join('\u001f');
    }

    return null;
}

export function dedupePublicShareMessagesForDisplay(messages: Message[], duplicateWindowMs = 30_000): Message[] {
    const result: Message[] = [];
    const seenIds = new Set<string>();
    const seenLocalIds = new Set<string>();
    const seenStableDisplayKeys = new Set<string>();
    const keptAtByDuplicateKey = new Map<string, number>();

    for (const message of [...messages].sort((a, b) => b.createdAt - a.createdAt)) {
        if (seenIds.has(message.id)) {
            continue;
        }
        seenIds.add(message.id);

        const localId = 'localId' in message ? message.localId : null;
        if (localId) {
            if (seenLocalIds.has(localId)) {
                continue;
            }
            seenLocalIds.add(localId);
        }

        const stableDisplayKey = publicShareStableDisplayKey(message);
        if (stableDisplayKey) {
            if (seenStableDisplayKeys.has(stableDisplayKey)) {
                continue;
            }
            seenStableDisplayKeys.add(stableDisplayKey);
        }

        const duplicateKey = publicShareMessageDuplicateKey(message);
        if (duplicateKey) {
            const keptAt = keptAtByDuplicateKey.get(duplicateKey);
            if (keptAt !== undefined && Math.abs(keptAt - message.createdAt) <= duplicateWindowMs) {
                continue;
            }
            keptAtByDuplicateKey.set(duplicateKey, message.createdAt);
        }

        result.push(message);
    }

    return result.sort((a, b) => b.createdAt - a.createdAt);
}
