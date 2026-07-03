import React from 'react';
import { Platform, View, Text } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet } from 'react-native-unistyles';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { CompanyInviteRow } from '@/components/company/CompanyInviteRow';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { showCopiedToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { buildCompanyInviteUrl, createCompanyInvite, listCompanyInvites, revokeCompanyInvite } from '@/sync/apiCompany';
import type { CompanyInvite } from '@/sync/companyTypes';

function getAppOrigin() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return window.location.origin;
    }
    return 'happy://';
}

export default function CompanyInvitesScreen() {
    const { isInDrawer } = useDesktopRoute();
    const auth = useAuth();
    const [invites, setInvites] = React.useState<CompanyInvite[]>([]);

    const load = React.useCallback(async () => {
        if (!auth.credentials) return;
        try {
            setInvites((await listCompanyInvites(auth.credentials)).invites);
        } catch {
            Modal.alert(t('common.error'), t('company.loadFailed'));
        }
    }, [auth.credentials]);

    React.useEffect(() => { load(); }, [load]);

    const createInvite = async () => {
        if (!auth.credentials) return;
        try {
            const created = await createCompanyInvite(auth.credentials, {});
            const url = created.url || buildCompanyInviteUrl(getAppOrigin(), created.token);
            await Clipboard.setStringAsync(url);
            showCopiedToast();
            Modal.alert(t('company.createInvite'), t('company.inviteCopied'));
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.createInviteFailed'));
        }
    };

    const revoke = async (invite: CompanyInvite) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(t('company.revokeInvite'), t('company.revokeInvite'), { confirmText: t('company.revokeInvite'), destructive: true });
        if (!confirmed) return;
        try {
            await revokeCompanyInvite(auth.credentials, invite.id);
            await load();
        } catch {
            Modal.alert(t('common.error'), t('company.revokeInviteFailed'));
        }
    };

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('company.invites'), headerBackTitle: t('common.back') }} />}
            <ItemGroup>
                <Item title={t('company.createInvite')} subtitle={t('company.copyInviteLink')} onPress={createInvite} />
            </ItemGroup>
            <ItemGroup title={t('company.invites')}>
                {invites.length === 0 ? (
                    <View style={styles.empty}><Text style={styles.emptyText}>{t('company.noInvites')}</Text></View>
                ) : invites.map((invite) => (
                    <CompanyInviteRow key={invite.id} invite={invite} onRevoke={() => revoke(invite)} />
                ))}
            </ItemGroup>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    empty: { alignItems: 'center', padding: 32 },
    emptyText: { color: theme.colors.textSecondary, textAlign: 'center' },
}));
