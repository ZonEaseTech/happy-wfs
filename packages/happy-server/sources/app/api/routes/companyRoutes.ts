import { CompanyRole } from '@prisma/client';
import { z } from 'zod';
import {
    acceptCompanyInvite,
    createCompanyInvite,
    getCompanyOverviewForUser,
    listCompanyInvites,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
    updateCompanyProfile,
} from '@/app/company/companyService';
import { Fastify } from '../types';

const roleSchema = z.nativeEnum(CompanyRole);
const companySlugSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const companyUpdateSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: companySlugSchema.optional(),
}).refine((value) => value.name !== undefined || value.slug !== undefined, { message: 'No changes provided' });
const membersQuerySchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});
const accountParamsSchema = z.object({ accountId: z.string() });
const inviteParamsSchema = z.object({ id: z.string() });
const updateMemberSchema = z.object({
    role: roleSchema.optional(),
    remove: z.boolean().optional(),
}).refine((value) => value.role !== undefined || value.remove === true, { message: 'No member action provided' });
const createInviteSchema = z.object({
    role: roleSchema.optional(),
    expiresAt: z.number().int().positive().optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
});
const acceptInviteSchema = z.object({ token: z.string().min(16) });

function buildInviteUrl(request: any, token: string) {
    const publicAppUrl = process.env.HAPPY_PUBLIC_APP_URL?.replace(/\/+$/, '');
    if (publicAppUrl) {
        return `${publicAppUrl}/company/join/${encodeURIComponent(token)}`;
    }
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
        return `${origin.replace(/\/+$/, '')}/company/join/${encodeURIComponent(token)}`;
    }
    return null;
}

function sendServiceError(reply: any, error: unknown) {
    const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;
    const message = typeof (error as any)?.message === 'string' ? (error as any).message : 'Internal server error';
    return reply.code(statusCode).send({ error: message });
}

export function companyRoutes(app: Fastify) {
    app.get('/v1/company', { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send(await getCompanyOverviewForUser(request.userId));
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.patch('/v1/company', {
        preHandler: app.authenticate,
        schema: { body: companyUpdateSchema },
    }, async (request, reply) => {
        try {
            const company = await updateCompanyProfile(request.userId, request.body);
            return reply.send({ company });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.get('/v1/company/members', {
        preHandler: app.authenticate,
        schema: { querystring: membersQuerySchema },
    }, async (request, reply) => {
        try {
            const members = await listCompanyMembers(request.userId, request.query);
            return reply.send({ members });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.patch('/v1/company/members/:accountId', {
        preHandler: app.authenticate,
        schema: { params: accountParamsSchema, body: updateMemberSchema },
    }, async (request, reply) => {
        try {
            const result = await updateCompanyMember(request.userId, request.params.accountId, request.body);
            return reply.send(result);
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.post('/v1/company/invites', {
        preHandler: app.authenticate,
        schema: { body: createInviteSchema },
    }, async (request, reply) => {
        try {
            const result = await createCompanyInvite(request.userId, request.body);
            return reply.code(201).send({
                invite: result.invite,
                token: result.token,
                url: buildInviteUrl(request, result.token),
            });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.get('/v1/company/invites', { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send({ invites: await listCompanyInvites(request.userId) });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.delete('/v1/company/invites/:id', {
        preHandler: app.authenticate,
        schema: { params: inviteParamsSchema },
    }, async (request, reply) => {
        try {
            const invite = await revokeCompanyInvite(request.userId, request.params.id);
            return reply.send({ invite });
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });

    app.post('/v1/company/invites/accept', {
        preHandler: app.authenticate,
        schema: { body: acceptInviteSchema },
    }, async (request, reply) => {
        try {
            return reply.send(await acceptCompanyInvite(request.userId, request.body.token));
        } catch (error) {
            return sendServiceError(reply, error);
        }
    });
}
