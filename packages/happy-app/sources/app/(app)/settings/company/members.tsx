import React from 'react';
import { View, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { CompanyMemberRow } from '@/components/company/CompanyMemberRow';
import { canCurrentUserManageMember } from '@/components/company/companyRole';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { getCompanyOverview, listCompanyMembers, updateCompanyMember } from '@/sync/apiCompany';
import type { CompanyMember, CompanyOverviewResponse } from '@/sync/companyTypes';

function getMemberName(member: CompanyMember) {
    return [member.profile.firstName, member.profile.lastName].filter(Boolean).join(' ') || member.profile.username || member.profile.id;
}

export default function CompanyMembersScreen() {
    const { isInDrawer } = useDesktopRoute();
    const auth = useAuth();
    const [overview, setOverview] = React.useState<CompanyOverviewResponse | null>(null);
    const [members, setMembers] = React.useState<CompanyMember[]>([]);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        try {
            const [nextOverview, nextMembers] = await Promise.all([
                getCompanyOverview(auth.credentials),
                listCompanyMembers(auth.credentials),
            ]);
            setOverview(nextOverview);
            setMembers(nextMembers.members);
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const removeMember = async (member: CompanyMember) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(
            t('company.removeMember'),
            t('company.removeMemberConfirm', { name: getMemberName(member) }),
            { confirmText: t('company.removeMember'), destructive: true }
        );
        if (!confirmed) return;
        try {
            await updateCompanyMember(auth.credentials, member.accountId, { remove: true });
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.lastOwnerHint'));
        }
    };

    const actorRole = overview?.membership.role;

    const manageMember = async (member: CompanyMember) => {
        if (!auth.credentials || !actorRole) return;
        if (actorRole === 'admin') {
            await removeMember(member);
            return;
        }
        const rawAction = await Modal.prompt(
            t('company.changeRole'),
            t('company.rolePrompt'),
            { defaultValue: member.role, placeholder: 'owner/admin/member/remove', confirmText: t('common.save') }
        );
        const action = rawAction?.trim().toLowerCase();
        if (!action) return;
        if (action !== 'owner' && action !== 'admin' && action !== 'member' && action !== 'remove') {
            Modal.alert(t('common.error'), t('company.rolePrompt'));
            return;
        }
        try {
            if (action === 'remove') {
                await updateCompanyMember(auth.credentials, member.accountId, { remove: true });
            } else {
                await updateCompanyMember(auth.credentials, member.accountId, { role: action });
            }
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.lastOwnerHint'));
        }
    };

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.members'), headerBackTitle: t('common.back') }} />}
            <ItemGroup title={t('company.members')}>
                {members.length === 0 ? (
                    <View style={styles.empty}><Text style={styles.emptyText}>{t('company.noMembers')}</Text></View>
                ) : members.map((member) => (
                    <CompanyMemberRow
                        key={member.accountId}
                        member={member}
                        onPress={actorRole && canCurrentUserManageMember(actorRole, member.role, actorRole === 'owner' ? 'role' : 'remove') ? () => manageMember(member) : undefined}
                    />
                ))}
            </ItemGroup>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    empty: { alignItems: 'center', padding: 32 },
    emptyText: { color: theme.colors.textSecondary, textAlign: 'center' },
}));
