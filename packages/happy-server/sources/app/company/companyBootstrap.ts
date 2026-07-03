import { CompanyRole } from '@prisma/client';
import { db } from '@/storage/db';
import { log } from '@/utils/log';

export const DEFAULT_COMPANY_ID = 'company_default';
export const DEFAULT_COMPANY_SLUG = 'default';

function defaultCompanyName() {
    return process.env.HAPPY_COMPANY_NAME?.trim() || 'Happy Company';
}

export async function ensureDefaultCompany() {
    const existing = await db.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
    if (existing) {
        return existing;
    }
    return db.company.create({
        data: {
            id: DEFAULT_COMPANY_ID,
            name: defaultCompanyName(),
            slug: DEFAULT_COMPANY_SLUG,
        },
    });
}

async function selectConfiguredOwnerAccountId(): Promise<string | null> {
    const configuredId = process.env.HAPPY_COMPANY_OWNER_ACCOUNT_ID?.trim();
    if (configuredId) {
        const account = await db.account.findUnique({ where: { id: configuredId }, select: { id: true } });
        return account?.id || null;
    }

    const configuredUsername = process.env.HAPPY_COMPANY_OWNER_USERNAME?.trim();
    if (configuredUsername) {
        const account = await db.account.findUnique({ where: { username: configuredUsername }, select: { id: true } });
        return account?.id || null;
    }

    const firstAccount = await db.account.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
    });
    return firstAccount?.id || null;
}

export async function ensureDefaultCompanyMemberships() {
    const company = await ensureDefaultCompany();
    const accounts = await db.account.findMany({ select: { id: true } });

    for (const account of accounts) {
        await db.companyMembership.upsert({
            where: {
                companyId_accountId: {
                    companyId: company.id,
                    accountId: account.id,
                },
            },
            update: {},
            create: {
                companyId: company.id,
                accountId: account.id,
                role: CompanyRole.member,
            },
        });
    }

    const ownerCount = await db.companyMembership.count({
        where: { companyId: company.id, role: CompanyRole.owner },
    });
    if (ownerCount === 0) {
        const ownerAccountId = await selectConfiguredOwnerAccountId();
        if (ownerAccountId) {
            await db.companyMembership.update({
                where: {
                    companyId_accountId: {
                        companyId: company.id,
                        accountId: ownerAccountId,
                    },
                },
                data: { role: CompanyRole.owner },
            });
            log({ module: 'company', level: 'info' }, `Selected default company owner account ${ownerAccountId}`);
        } else {
            log({ module: 'company', level: 'warn' }, 'Default company has no accounts, owner selection skipped');
        }
    }

    return company;
}
