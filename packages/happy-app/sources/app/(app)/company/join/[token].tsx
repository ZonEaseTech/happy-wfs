import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { acceptCompanyInvite } from '@/sync/apiCompany';

export default function CompanyJoinScreen() {
    const router = useRouter();
    const auth = useAuth();
    const params = useLocalSearchParams<{ token?: string }>();
    const token = Array.isArray(params.token) ? params.token[0] : params.token;
    const [message, setMessage] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    const accept = React.useCallback(async () => {
        if (!token || !auth.credentials) return;
        setLoading(true);
        try {
            const result = await acceptCompanyInvite(auth.credentials, token);
            setMessage(result.alreadyMember ? t('company.alreadyMember') : t('company.inviteAccepted'));
        } catch {
            setMessage(t('company.inviteInvalid'));
        } finally {
            setLoading(false);
        }
    }, [auth.credentials, token]);

    React.useEffect(() => {
        if (auth.credentials && token) {
            accept();
        }
    }, [accept, auth.credentials, token]);

    return (
        <ItemList>
            <Stack.Screen options={{ headerTitle: t('company.joinCompany'), headerBackTitle: t('common.back') }} />
            <ItemGroup title={t('company.joinCompany')}>
                {!auth.credentials ? (
                    <Item title={t('company.inviteLoginRequired')} onPress={() => router.push('/')} />
                ) : (
                    <Item title={message || t('common.loading')} loading={loading} showChevron={false} />
                )}
                {auth.credentials && token && message !== t('company.inviteAccepted') && (
                    <Item title={t('common.retry')} onPress={accept} loading={loading} showChevron={false} />
                )}
            </ItemGroup>
        </ItemList>
    );
}
