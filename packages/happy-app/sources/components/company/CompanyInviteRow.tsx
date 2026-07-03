import React from 'react';
import { Item } from '@/components/Item';
import { t } from '@/text';
import type { CompanyInvite } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from './companyRole';

function getInviteStatus(invite: CompanyInvite) {
    if (invite.revokedAt) return t('company.revokedInvite');
    if (invite.expiresAt && invite.expiresAt <= Date.now()) return t('company.expiredInvite');
    return t('company.activeInvite');
}

export function CompanyInviteRow({ invite, onRevoke }: { invite: CompanyInvite; onRevoke?: () => void }) {
    const parts = [
        t(getCompanyRoleLabelKey(invite.role)),
        t('company.uses', { count: invite.useCount }),
        invite.expiresAt ? t('company.expiresAt', { date: new Date(invite.expiresAt).toLocaleDateString() }) : null,
    ].filter(Boolean);

    return (
        <Item
            title={getInviteStatus(invite)}
            subtitle={parts.join(' • ')}
            detail={invite.revokedAt ? undefined : t('company.revokeInvite')}
            onPress={invite.revokedAt ? undefined : onRevoke}
            showChevron={false}
        />
    );
}
