import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDesktopRoute, useDesktopRoutes } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { getCompanyOverview, updateCompanyProfile } from '@/sync/apiCompany';
import type { CompanyOverviewResponse } from '@/sync/companyTypes';
import { getCompanyRoleLabelKey } from '@/components/company/companyRole';

export default function CompanySettingsScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { open } = useDesktopRoutes();
    const auth = useAuth();
    const [overview, setOverview] = React.useState<CompanyOverviewResponse | null>(null);
    const [loading, setLoading] = React.useState(true);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        setLoading(true);
        try {
            setOverview(await getCompanyOverview(auth.credentials));
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const editName = async () => {
        if (!auth.credentials || !overview?.capabilities.canEditCompany) return;
        const name = await Modal.prompt(t('company.name'), t('company.editProfile'), { defaultValue: overview.company.name, confirmText: t('common.save') });
        if (!name?.trim()) return;
        try {
            await updateCompanyProfile(auth.credentials, { name: name.trim() });
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.saveProfileFailed'));
        }
    };

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.title'), headerBackTitle: t('common.back') }} />}
            <ItemGroup title={t('company.profile')}>
                <Item title={t('company.name')} detail={overview?.company.name || (loading ? t('common.loading') : '')} onPress={overview?.capabilities.canEditCompany ? editName : undefined} showChevron={!!overview?.capabilities.canEditCompany} />
                <Item title={t('company.slug')} detail={overview?.company.slug || ''} showChevron={false} />
                <Item title={t('company.role')} detail={overview ? t(getCompanyRoleLabelKey(overview.membership.role)) : ''} showChevron={false} />
            </ItemGroup>
            <ItemGroup>
                <Item title={t('company.members')} subtitle={t('company.membersSubtitle')} icon={<Ionicons name="people-outline" size={29} color="#007AFF" />} onPress={() => open('/settings/company/members', { title: t('company.members') })} />
                {overview?.capabilities.canManageInvites && (
                    <Item title={t('company.invites')} subtitle={t('company.invitesSubtitle')} icon={<Ionicons name="link-outline" size={29} color="#34C759" />} onPress={() => open('/settings/company/invites', { title: t('company.invites') })} />
                )}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
}
