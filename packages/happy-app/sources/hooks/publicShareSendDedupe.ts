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
