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
