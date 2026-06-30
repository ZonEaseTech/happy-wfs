import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { isSessionOwner } from "@/app/share/accessControl";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { logPublicShareAccess, getIpAddress, getUserAgent } from "@/app/share/accessLogger";
import { PROFILE_SELECT, toShareUserProfile } from "@/app/share/types";
import { eventRouter, buildPublicShareCreatedUpdate, buildPublicShareUpdatedUpdate, buildPublicShareDeletedUpdate } from "@/app/events/eventRouter";
import { allocateUserSeq } from "@/storage/seq";
import { createHash } from "crypto";
import { decodeBase64 } from "privacy-kit";
import { touchSession } from "@/app/session/sessionTouch";
import { dispatchSessionMessage } from "@/app/session/sessionMessageDispatch";
import { chatImageUpload } from "@/app/chat/chatImageUpload";
import { s3bucket, s3client, getPublicUrl } from "@/storage/files";
import { randomKey } from "@/utils/randomKey";
import { buildPublicFileSharePath, sanitizePublicFileName } from "@/app/fileShare/publicFileShare";
import { invokeUserRpc } from "@/app/api/socket/rpcRegistry";

const PUBLIC_SHARE_FILE_MAX_BYTES = 100 * 1024 * 1024;

const sendPublicShareMessageBodySchema = z.object({
    content: z.string().min(1),
    localId: z.string().min(1),
});

const publicShareAbortBodySchema = z.object({
    params: z.string().min(1),
});

function isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

function toPublicShareSendResponseMessage(message: {
    id: string;
    seq: number;
    localId: string | null;
    sentBy: string | null;
    sentByName: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        sentBy: message.sentBy,
        sentByName: message.sentByName,
        createdAt: message.createdAt.getTime(),
        updatedAt: message.updatedAt.getTime(),
    };
}

function contentDispositionAttachment(fileName: string): string {
    const asciiFallback = fileName.replace(/[\\"\r\n]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'file';
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function loadPublicShareForChat(token: string, consent: boolean | undefined, userId: string | null) {
    const tokenHash = createHash('sha256').update(token, 'utf8').digest();
    const publicShare = await db.publicSessionShare.findUnique({
        where: { tokenHash },
        select: {
            id: true,
            sessionId: true,
            expiresAt: true,
            maxUses: true,
            useCount: true,
            isConsentRequired: true,
            allowChat: true,
            session: {
                select: {
                    accountId: true
                }
            },
            blockedUsers: userId ? {
                where: { userId },
                select: { id: true }
            } : undefined
        }
    });

    if (!publicShare || (publicShare.expiresAt && publicShare.expiresAt < new Date())) {
        return { ok: false as const, code: 404, body: { error: 'Public share not found or expired' } };
    }
    if (publicShare.maxUses && publicShare.useCount >= publicShare.maxUses) {
        return { ok: false as const, code: 404, body: { error: 'Public share not found or expired' } };
    }
    if (userId && publicShare.blockedUsers && publicShare.blockedUsers.length > 0) {
        return { ok: false as const, code: 404, body: { error: 'Public share not found or expired' } };
    }
    if (publicShare.isConsentRequired && !consent) {
        const session = await db.session.findUnique({
            where: { id: publicShare.sessionId },
            select: {
                account: {
                    select: PROFILE_SELECT
                }
            }
        });
        return {
            ok: false as const,
            code: 403,
            body: {
                error: 'Consent required',
                requiresConsent: true,
                sessionId: publicShare.sessionId,
                owner: session?.account ? toShareUserProfile(session.account) : null
            }
        };
    }
    if (!publicShare.allowChat) {
        return { ok: false as const, code: 403, body: { error: 'Public share chat is disabled' } };
    }
    return { ok: true as const, publicShare };
}

/**
 * Public session sharing API routes
 *
 * Public shares are view-only unless the owner enables public chat.
 */
export function publicShareRoutes(app: Fastify) {

    /**
     * Create or update public share for a session
     */
    app.post('/v1/sessions/:sessionId/public-share', {
        preHandler: app.authenticate,
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            body: z.object({
                token: z.string().optional(), // client-generated token (required when creating or rotating)
                encryptedDataKey: z.string().optional(), // base64 encoded (required when creating or rotating)
                expiresAt: z.number().optional(), // timestamp
                maxUses: z.number().int().positive().optional(),
                isConsentRequired: z.boolean().optional(), // require consent for detailed logging
                allowChat: z.boolean().optional()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { token, encryptedDataKey, expiresAt, maxUses, isConsentRequired, allowChat } = request.body;

        // Only owner can create public shares
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        // Check if public share already exists
        const existing = await db.publicSessionShare.findUnique({
            where: { sessionId }
        });

        const isUpdate = !!existing;

        // Validate inputs before opening the transaction (early returns are not
        // possible from inside db.$transaction callback).
        if (existing) {
            const shouldRotateToken = typeof token === 'string' && token.length > 0;
            if (shouldRotateToken && !encryptedDataKey) {
                return reply.code(400).send({ error: 'encryptedDataKey required when rotating token' });
            }
        } else {
            if (!token) {
                return reply.code(400).send({ error: 'token required' });
            }
            if (!encryptedDataKey) {
                return reply.code(400).send({ error: 'encryptedDataKey required' });
            }
        }

        const publicShare = await db.$transaction(async (tx) => {
            let result;
            if (existing) {
                const shouldRotateToken = typeof token === 'string' && token.length > 0;
                const nextTokenHash = shouldRotateToken ? createHash('sha256').update(token!, 'utf8').digest() : null;

                // Update existing share (token is stored as a hash only; token itself is not persisted)
                result = await tx.publicSessionShare.update({
                    where: { sessionId },
                    data: {
                        ...(nextTokenHash ? { tokenHash: nextTokenHash } : {}),
                        ...(encryptedDataKey ? { encryptedDataKey: decodeBase64(encryptedDataKey, 'base64') } : {}),
                        expiresAt: expiresAt ? new Date(expiresAt) : null,
                        maxUses: maxUses ?? null,
                        isConsentRequired: isConsentRequired ?? false,
                        allowChat: allowChat ?? false,
                        ...(nextTokenHash ? { useCount: 0 } : {}),
                    }
                });
            } else {
                const tokenHash = createHash('sha256').update(token!, 'utf8').digest();

                // Create new share with client-provided token
                result = await tx.publicSessionShare.create({
                    data: {
                        sessionId,
                        createdByUserId: userId,
                        tokenHash,
                        encryptedDataKey: decodeBase64(encryptedDataKey!, 'base64'),
                        expiresAt: expiresAt ? new Date(expiresAt) : null,
                        maxUses: maxUses ?? null,
                        isConsentRequired: isConsentRequired ?? false,
                        allowChat: allowChat ?? false
                    }
                });
            }
            await touchSession(tx, sessionId);
            return result;
        });

        // Emit real-time update to session owner only (no session-scoped broadcast
        // since public-share-created includes the raw token which must not leak)
        const updateSeq = await allocateUserSeq(userId);
        const updatePayload = isUpdate
            ? buildPublicShareUpdatedUpdate(publicShare, updateSeq, randomKeyNaked(12))
            : buildPublicShareCreatedUpdate({ ...publicShare, token: token! }, updateSeq, randomKeyNaked(12));

        eventRouter.emitUpdate({
            userId: userId,
            payload: updatePayload,
        });

        return reply.send({
            publicShare: {
                id: publicShare.id,
                token: token ?? null,
                expiresAt: publicShare.expiresAt?.getTime() ?? null,
                maxUses: publicShare.maxUses,
                useCount: publicShare.useCount,
                isConsentRequired: publicShare.isConsentRequired,
                allowChat: publicShare.allowChat,
                createdAt: publicShare.createdAt.getTime(),
                updatedAt: publicShare.updatedAt.getTime()
            }
        });
    });

    /**
     * Get public share info for a session
     */
    app.get('/v1/sessions/:sessionId/public-share', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Only owner can view public share settings
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { sessionId }
        });

        if (!publicShare) {
            return reply.send({ publicShare: null });
        }

        return reply.send({
            publicShare: {
                id: publicShare.id,
                token: null,
                expiresAt: publicShare.expiresAt?.getTime() ?? null,
                maxUses: publicShare.maxUses,
                useCount: publicShare.useCount,
                isConsentRequired: publicShare.isConsentRequired,
                allowChat: publicShare.allowChat,
                createdAt: publicShare.createdAt.getTime(),
                updatedAt: publicShare.updatedAt.getTime()
            }
        });
    });

    /**
     * Delete public share (disable public link)
     */
    app.delete('/v1/sessions/:sessionId/public-share', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Only owner can delete public share
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        // Use transaction to ensure consistent state
        const deleted = await db.$transaction(async (tx) => {
            // Check if share exists
            const existing = await tx.publicSessionShare.findUnique({
                where: { sessionId }
            });

            if (!existing) {
                return false;
            }

            // Delete public share
            await tx.publicSessionShare.delete({
                where: { sessionId }
            });

            await touchSession(tx, sessionId);

            return true;
        });

        // Emit real-time update to session owner (outside transaction)
        if (deleted) {
            const updateSeq = await allocateUserSeq(userId);
            const updatePayload = buildPublicShareDeletedUpdate(
                sessionId,
                updateSeq,
                randomKeyNaked(12)
            );

            eventRouter.emitUpdate({
                userId: userId,
                payload: updatePayload,
            });
        }

        return reply.send({ success: true });
    });

    /**
     * Access session via public share token (no auth required)
     *
     * If isConsentRequired is true, client must pass consent=true query param
     */
    app.get('/v1/public-share/:token', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent } = request.query || {};
        const tokenHash = createHash('sha256').update(token, 'utf8').digest();

        // Try to get user ID if authenticated
        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Not authenticated, continue as anonymous
            }
        }

        // Use transaction to atomically check limits and increment use count
        const result = await db.$transaction(async (tx) => {
            // Check access and get full public share data
            const publicShare = await tx.publicSessionShare.findUnique({
                where: { tokenHash },
                select: {
                    id: true,
                    sessionId: true,
                    expiresAt: true,
                    maxUses: true,
                    useCount: true,
                    isConsentRequired: true,
                    allowChat: true,
                    encryptedDataKey: true,
                    blockedUsers: userId ? {
                        where: { userId },
                        select: { id: true }
                    } : undefined
                }
            });

            if (!publicShare) {
                return { error: 'Public share not found or expired' };
            }

            // Check if expired
            if (publicShare.expiresAt && publicShare.expiresAt < new Date()) {
                return { error: 'Public share not found or expired' };
            }

            // Check if max uses exceeded (before incrementing)
            if (publicShare.maxUses && publicShare.useCount >= publicShare.maxUses) {
                return { error: 'Public share not found or expired' };
            }

            // Check if user is blocked
            if (userId && publicShare.blockedUsers && publicShare.blockedUsers.length > 0) {
                return { error: 'Public share not found or expired' };
            }

            // Check consent requirement
            if (publicShare.isConsentRequired && !consent) {
                return {
                    error: 'Consent required',
                    requiresConsent: true,
                    publicShareId: publicShare.id,
                    sessionId: publicShare.sessionId
                };
            }

            // Increment use count atomically
            await tx.publicSessionShare.update({
                where: { id: publicShare.id },
                data: { useCount: { increment: 1 } }
            });

            return {
                success: true,
                publicShareId: publicShare.id,
                sessionId: publicShare.sessionId,
                isConsentRequired: publicShare.isConsentRequired,
                allowChat: publicShare.allowChat,
                encryptedDataKey: publicShare.encryptedDataKey
            };
        });

        // Handle errors from transaction
        if ('error' in result) {
            if (result.requiresConsent) {
                // Get owner info even when consent is required
                const session = await db.session.findUnique({
                    where: { id: result.sessionId },
                    select: {
                        account: {
                            select: PROFILE_SELECT
                        }
                    }
                });

                return reply.code(403).send({
                    error: result.error,
                    requiresConsent: true,
                    sessionId: result.sessionId,
                    owner: session?.account ? toShareUserProfile(session.account) : null
                });
            }
            return reply.code(404).send({ error: result.error });
        }

        // Log access (only log IP/UA if consent was given)
        const ipAddress = result.isConsentRequired ? getIpAddress(request.headers) : undefined;
        const userAgent = result.isConsentRequired ? getUserAgent(request.headers) : undefined;
        await logPublicShareAccess(result.publicShareId, userId, ipAddress, userAgent);

        // Get session info with owner profile
        const session = await db.session.findUnique({
            where: { id: result.sessionId },
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                active: true,
                lastActiveAt: true,
                account: {
                    select: PROFILE_SELECT
                }
            }
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        return reply.send({
            session: {
                id: session.id,
                seq: session.seq,
                createdAt: session.createdAt.getTime(),
                updatedAt: session.updatedAt.getTime(),
                active: session.active,
                activeAt: session.lastActiveAt.getTime(),
                metadata: session.metadata,
                metadataVersion: session.metadataVersion,
                agentState: session.agentState,
                agentStateVersion: session.agentStateVersion
            },
            owner: toShareUserProfile(session.account),
            accessLevel: 'view',
            encryptedDataKey: Buffer.from(result.encryptedDataKey).toString('base64'),
            isConsentRequired: result.isConsentRequired,
            allowChat: result.allowChat
        });
    });

    /**
     * Get messages for a public share token (no auth required)
     *
     * NOTE: Does not increment useCount (useCount is incremented on /v1/public-share/:token).
     */
    app.get('/v1/public-share/:token/messages', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional(),
                before: z.coerce.number().int().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(150)
            }).optional()
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent, before, limit = 150 } = request.query || {};
        const tokenHash = createHash('sha256').update(token, 'utf8').digest();

        // Try to get user ID if authenticated
        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Not authenticated, continue as anonymous
            }
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                sessionId: true,
                expiresAt: true,
                maxUses: true,
                useCount: true,
                isConsentRequired: true,
                allowChat: true,
                blockedUsers: userId ? {
                    where: { userId },
                    select: { id: true }
                } : undefined
            }
        });

        if (!publicShare) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        // Check if expired
        if (publicShare.expiresAt && publicShare.expiresAt < new Date()) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        // Check if max uses exceeded
        if (publicShare.maxUses && publicShare.useCount >= publicShare.maxUses) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        // Check if user is blocked
        if (userId && publicShare.blockedUsers && publicShare.blockedUsers.length > 0) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        // Check consent requirement
        if (publicShare.isConsentRequired && !consent) {
            const session = await db.session.findUnique({
                where: { id: publicShare.sessionId },
                select: {
                    account: {
                        select: PROFILE_SELECT
                    }
                }
            });

            return reply.code(403).send({
                error: 'Consent required',
                requiresConsent: true,
                sessionId: publicShare.sessionId,
                owner: session?.account ? toShareUserProfile(session.account) : null
            });
        }

        const messages = await db.sessionMessage.findMany({
            where: {
                sessionId: publicShare.sessionId,
                ...(before !== undefined ? { seq: { lt: before } } : {})
            },
            orderBy: { seq: 'desc' },
            take: limit + 1,
            select: {
                id: true,
                seq: true,
                localId: true,
                content: true,
                createdAt: true,
                updatedAt: true
            }
        });

        const hasMore = messages.length > limit;
        const result = messages.slice(0, limit);

        return reply.send({
            messages: result.map((v) => ({
                id: v.id,
                seq: v.seq,
                content: v.content,
                localId: v.localId,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime()
            })),
            hasMore
        });
    });

    app.post('/v1/public-share/:token/upload-image', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent } = request.query || {};

        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Public share upload remains available to anonymous visitors.
            }
        }

        const access = await loadPublicShareForChat(token, consent, userId);
        if (!access.ok) {
            return reply.code(access.code).send(access.body);
        }

        let fileBuffer: Buffer | null = null;
        let fileMimeType: string | null = null;
        for await (const part of request.parts()) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                fileMimeType = part.mimetype;
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        const mimeType = fileMimeType || 'image/jpeg';
        if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
            return reply.status(400).send({ error: 'Only JPEG and PNG images are supported' });
        }

        const result = await chatImageUpload(
            access.publicShare.session.accountId,
            access.publicShare.sessionId,
            fileBuffer,
            mimeType,
        );

        return reply.send({
            success: true,
            data: result,
        });
    });

    app.post('/v1/public-share/:token/upload-file', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent } = request.query || {};

        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Public share upload remains available to anonymous visitors.
            }
        }

        const access = await loadPublicShareForChat(token, consent, userId);
        if (!access.ok) {
            return reply.code(access.code).send(access.body);
        }

        let fileBuffer: Buffer | null = null;
        let fileMimeType = 'application/octet-stream';
        let fileName = 'file';
        for await (const part of request.parts()) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                fileMimeType = part.mimetype || fileMimeType;
                fileName = sanitizePublicFileName(part.filename || fileName);
            } else if (part.type === 'field' && part.fieldname === 'fileName' && typeof part.value === 'string') {
                fileName = sanitizePublicFileName(part.value);
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }
        if (fileBuffer.length > PUBLIC_SHARE_FILE_MAX_BYTES) {
            return reply.status(413).send({ error: 'File exceeds 100MB limit' });
        }

        const shareKey = randomKey('file', 20);
        const objectPath = buildPublicFileSharePath(access.publicShare.session.accountId, shareKey, fileName);
        await s3client.putObject(s3bucket, objectPath, fileBuffer, fileBuffer.length, {
            'Content-Type': fileMimeType,
            'Content-Disposition': contentDispositionAttachment(fileName),
        });

        return reply.send({
            success: true,
            data: {
                url: getPublicUrl(objectPath),
                path: objectPath,
                fileName,
                mimeType: fileMimeType,
                size: fileBuffer.length,
            },
        });
    });

    /**
     * Send a message through a public share token.
     *
     * The client encrypts the raw user message with the public share data key.
     */
    app.post('/v1/public-share/:token/messages', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional()
            }).optional(),
            body: sendPublicShareMessageBodySchema
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent } = request.query || {};
        const { content, localId } = request.body;
        const tokenHash = createHash('sha256').update(token, 'utf8').digest();

        // Try to get user ID if authenticated
        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Not authenticated, continue as anonymous
            }
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                sessionId: true,
                expiresAt: true,
                maxUses: true,
                useCount: true,
                isConsentRequired: true,
                allowChat: true,
                session: {
                    select: {
                        accountId: true
                    }
                },
                blockedUsers: userId ? {
                    where: { userId },
                    select: { id: true }
                } : undefined
            }
        });

        if (!publicShare) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        if (publicShare.expiresAt && publicShare.expiresAt < new Date()) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        if (publicShare.maxUses && publicShare.useCount >= publicShare.maxUses) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        if (userId && publicShare.blockedUsers && publicShare.blockedUsers.length > 0) {
            return reply.code(404).send({ error: 'Public share not found or expired' });
        }

        if (publicShare.isConsentRequired && !consent) {
            const session = await db.session.findUnique({
                where: { id: publicShare.sessionId },
                select: {
                    account: {
                        select: PROFILE_SELECT
                    }
                }
            });

            return reply.code(403).send({
                error: 'Consent required',
                requiresConsent: true,
                sessionId: publicShare.sessionId,
                owner: session?.account ? toShareUserProfile(session.account) : null
            });
        }

        if (!publicShare.allowChat) {
            return reply.code(403).send({ error: 'Public share chat is disabled' });
        }

        const existing = await db.sessionMessage.findFirst({
            where: {
                sessionId: publicShare.sessionId,
                localId,
            },
            select: {
                id: true,
                seq: true,
                localId: true,
                sentBy: true,
                sentByName: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (existing) {
            return reply.send({ message: toPublicShareSendResponseMessage(existing) });
        }

        try {
            const dispatched = await dispatchSessionMessage({
                ownerId: publicShare.session.accountId,
                sessionId: publicShare.sessionId,
                content,
                localId,
                sentBy: null,
                sentByName: 'Public visitor',
                trackCliDelivery: true,
            });

            return reply.send({
                message: toPublicShareSendResponseMessage(dispatched.message),
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }

            const deduped = await db.sessionMessage.findFirst({
                where: {
                    sessionId: publicShare.sessionId,
                    localId,
                },
                select: {
                    id: true,
                    seq: true,
                    localId: true,
                    sentBy: true,
                    sentByName: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            if (!deduped) {
                throw error;
            }

            return reply.send({ message: toPublicShareSendResponseMessage(deduped) });
        }
    });


    app.post('/v1/public-share/:token/abort', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        },
        schema: {
            params: z.object({
                token: z.string()
            }),
            querystring: z.object({
                consent: z.coerce.boolean().optional()
            }).optional(),
            body: publicShareAbortBodySchema
        }
    }, async (request, reply) => {
        const { token } = request.params;
        const { consent } = request.query || {};
        const { params } = request.body;

        let userId: string | null = null;
        if (request.headers.authorization) {
            try {
                await app.authenticate(request, reply);
                userId = request.userId;
            } catch {
                // Not authenticated, continue as anonymous
            }
        }

        const result = await loadPublicShareForChat(token, consent, userId);
        if (!result.ok) {
            return reply.code(result.code).send(result.body);
        }

        try {
            const rpcResult = await invokeUserRpc(
                result.publicShare.session.accountId,
                `${result.publicShare.sessionId}:abort`,
                params,
                10000,
            );
            return reply.send({ ok: true, result: rpcResult });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'RPC call failed';
            const isTimeout = message.includes('timeout');
            return reply.code(isTimeout ? 504 : 502).send({
                ok: false,
                error: message,
            });
        }
    });

    /**
     * Get blocked users for public share
     */
    app.get('/v1/sessions/:sessionId/public-share/blocked-users', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Only owner can view blocked users
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!publicShare) {
            return reply.code(404).send({ error: 'Public share not found' });
        }

        const blockedUsers = await db.publicShareBlockedUser.findMany({
            where: { publicShareId: publicShare.id },
            include: {
                user: {
                    select: PROFILE_SELECT
                }
            },
            orderBy: { blockedAt: 'desc' }
        });

        return reply.send({
            blockedUsers: blockedUsers.map(bu => ({
                id: bu.id,
                user: toShareUserProfile(bu.user),
                reason: bu.reason,
                blockedAt: bu.blockedAt.getTime()
            }))
        });
    });

    /**
     * Block user from public share
     */
    app.post('/v1/sessions/:sessionId/public-share/blocked-users', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            body: z.object({
                userId: z.string(),
                reason: z.string().optional()
            })
        }
    }, async (request, reply) => {
        const ownerId = request.userId;
        const { sessionId } = request.params;
        const { userId, reason } = request.body;

        // Only owner can block users
        if (!await isSessionOwner(ownerId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!publicShare) {
            return reply.code(404).send({ error: 'Public share not found' });
        }

        const blockedUser = await db.publicShareBlockedUser.create({
            data: {
                publicShareId: publicShare.id,
                userId,
                reason: reason ?? null
            },
            include: {
                user: {
                    select: PROFILE_SELECT
                }
            }
        });

        return reply.send({
            blockedUser: {
                id: blockedUser.id,
                user: toShareUserProfile(blockedUser.user),
                reason: blockedUser.reason,
                blockedAt: blockedUser.blockedAt.getTime()
            }
        });
    });

    /**
     * Unblock user from public share
     */
    app.delete('/v1/sessions/:sessionId/public-share/blocked-users/:blockedUserId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                blockedUserId: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, blockedUserId } = request.params;

        // Only owner can unblock users
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        await db.publicShareBlockedUser.delete({
            where: { id: blockedUserId }
        });

        return reply.send({ success: true });
    });

    /**
     * Get access logs for public share
     */
    app.get('/v1/sessions/:sessionId/public-share/access-logs', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(100).default(50)
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const limit = request.query?.limit || 50;

        // Only owner can view access logs
        if (!await isSessionOwner(userId, sessionId)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const publicShare = await db.publicSessionShare.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!publicShare) {
            return reply.code(404).send({ error: 'Public share not found' });
        }

        const logs = await db.publicShareAccessLog.findMany({
            where: { publicShareId: publicShare.id },
            orderBy: { accessedAt: 'desc' },
            take: limit
        });

        // Fetch user profiles for authenticated accesses
        const userIds = [...new Set(logs.map(l => l.userId).filter((id): id is string => id !== null))];
        const users = userIds.length > 0
            ? await db.account.findMany({
                where: { id: { in: userIds } },
                select: PROFILE_SELECT
            })
            : [];
        const userMap = new Map(users.map(u => [u.id, u]));

        return reply.send({
            logs: logs.map(log => ({
                id: log.id,
                user: log.userId ? (userMap.has(log.userId) ? toShareUserProfile(userMap.get(log.userId)!) : null) : null,
                accessedAt: log.accessedAt.getTime(),
                ipAddress: log.ipAddress,
                userAgent: log.userAgent
            }))
        });
    });
}
