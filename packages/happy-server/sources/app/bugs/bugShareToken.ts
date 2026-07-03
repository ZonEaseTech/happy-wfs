import jwt from 'jsonwebtoken';

export interface BugShareTokenPayload {
    configId: string;
    ownerId: string;
    nickname: string;
    version: number;
}

const issuer = 'happy-bug-share';

function secret(): string {
    const value = process.env.HANDY_MASTER_SECRET;
    if (!value) throw new Error('HANDY_MASTER_SECRET is required');
    return `${value}:bug-share`;
}

export function createBugShareToken(payload: BugShareTokenPayload): string {
    return jwt.sign(payload, secret(), { issuer, expiresIn: '30d' });
}

export function verifyBugShareToken(token: string): BugShareTokenPayload | null {
    try {
        const decoded = jwt.verify(token, secret(), { issuer });
        if (!decoded || typeof decoded !== 'object') return null;
        const candidate = decoded as Record<string, unknown>;
        if (typeof candidate.configId !== 'string') return null;
        if (typeof candidate.ownerId !== 'string') return null;
        if (typeof candidate.nickname !== 'string') return null;
        if (typeof candidate.version !== 'number') return null;
        return {
            configId: candidate.configId,
            ownerId: candidate.ownerId,
            nickname: candidate.nickname,
            version: candidate.version,
        };
    } catch {
        return null;
    }
}
