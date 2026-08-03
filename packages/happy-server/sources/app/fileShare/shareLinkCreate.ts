import crypto from "crypto";
import { db } from "@/storage/db";
import { getPublicUrl } from "@/storage/files";

const CODE_LENGTH = 10;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const MAX_TITLE_LENGTH = 200;

function generateShareLinkCode(): string {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
}

/**
 * Returns true when the URL points at this deployment's public file-share
 * bucket and is an HTML document — the only content short links may target.
 */
export function isAllowedShareLinkUrl(url: string): boolean {
    const publicPrefix = getPublicUrl("public/file-shares/");
    if (!url.startsWith(publicPrefix)) return false;
    try {
        return /\.html?$/i.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

/**
 * Creates a short share-link code for a public HTML preview. Idempotent:
 * sharing the same url+title again returns the existing code instead of
 * minting a new one. Collision on the random code is retried.
 */
export async function shareLinkCreate(accountId: string, url: string, title: string | null): Promise<string> {
    const cleanTitle = title?.trim().slice(0, MAX_TITLE_LENGTH) || null;
    const existing = await db.publicShareLink.findFirst({
        where: { accountId, url, title: cleanTitle }
    });
    if (existing) {
        return existing.code;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const created = await db.publicShareLink.create({
                data: { code: generateShareLinkCode(), accountId, url, title: cleanTitle }
            });
            return created.code;
        } catch (error) {
            if (attempt === 2) throw error;
        }
    }
    throw new Error("unreachable");
}
