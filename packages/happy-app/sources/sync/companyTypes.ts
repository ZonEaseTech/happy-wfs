import * as z from 'zod';

export const CompanyRoleSchema = z.enum(['owner', 'admin', 'member']);
export type CompanyRole = z.infer<typeof CompanyRoleSchema>;

export const CompanyCapabilityFlagsSchema = z.object({
    canEditCompany: z.boolean(),
    canManageMembers: z.boolean(),
    canManageOwners: z.boolean(),
    canManageInvites: z.boolean(),
});
export type CompanyCapabilityFlags = z.infer<typeof CompanyCapabilityFlagsSchema>;

export const CompanySummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanySummary = z.infer<typeof CompanySummarySchema>;

export const CompanyMembershipSummarySchema = z.object({
    companyId: z.string(),
    accountId: z.string(),
    role: CompanyRoleSchema,
    joinedAt: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanyMembershipSummary = z.infer<typeof CompanyMembershipSummarySchema>;

export const CompanyMemberSchema = CompanyMembershipSummarySchema.extend({
    profile: z.object({
        id: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        username: z.string().nullable(),
        avatar: z.object({
            path: z.string(),
            url: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
            thumbhash: z.string().optional(),
        }).nullable(),
    }),
});
export type CompanyMember = z.infer<typeof CompanyMemberSchema>;

export const CompanyInviteSchema = z.object({
    id: z.string(),
    companyId: z.string(),
    role: CompanyRoleSchema,
    createdByUserId: z.string(),
    createdBy: z.object({
        id: z.string(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        username: z.string().nullable(),
    }).nullable(),
    expiresAt: z.number().nullable(),
    maxUses: z.number().nullable(),
    useCount: z.number(),
    revokedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type CompanyInvite = z.infer<typeof CompanyInviteSchema>;

export const CompanyOverviewResponseSchema = z.object({
    company: CompanySummarySchema,
    membership: CompanyMembershipSummarySchema,
    capabilities: CompanyCapabilityFlagsSchema,
});
export type CompanyOverviewResponse = z.infer<typeof CompanyOverviewResponseSchema>;

export const CompanyUpdateResponseSchema = z.object({ company: CompanySummarySchema });
export const CompanyMembersResponseSchema = z.object({ members: z.array(CompanyMemberSchema) });
export const CompanyInvitesResponseSchema = z.object({ invites: z.array(CompanyInviteSchema) });
export const CompanyInviteCreateResponseSchema = z.object({
    invite: CompanyInviteSchema,
    token: z.string(),
    url: z.string().nullable(),
});
export const CompanyInviteAcceptResponseSchema = z.object({
    company: CompanySummarySchema,
    membership: CompanyMembershipSummarySchema,
    alreadyMember: z.boolean(),
});

export type CompanyUpdateResponse = z.infer<typeof CompanyUpdateResponseSchema>;
export type CompanyMembersResponse = z.infer<typeof CompanyMembersResponseSchema>;
export type CompanyInvitesResponse = z.infer<typeof CompanyInvitesResponseSchema>;
export type CompanyInviteCreateResponse = z.infer<typeof CompanyInviteCreateResponseSchema>;
export type CompanyInviteAcceptResponse = z.infer<typeof CompanyInviteAcceptResponseSchema>;
