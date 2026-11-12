import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { useDesktopRoute, useRouteParams } from '@/components/desktopRoutes';
import { VaultKeyDetail } from '@/components/VaultKeyDetail';
import { t } from '@/text';
import { refreshVault, useVault } from '@/sync/vault';

/** Resource center › one key, for screens too narrow to show it next to the list. */
export default React.memo(function VaultKeyScreen() {
    const { theme } = useUnistyles();
    const { isInDrawer, dismiss } = useDesktopRoute();
    const { id } = useRouteParams<{ id?: string }>();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);
    const key = vault.keys.find((candidate) => candidate.id === id);
    const detail = id ? <VaultKeyDetail keyId={id} onDeleted={dismiss} /> : null;

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: key?.name ?? t('resources.keys'), headerBackTitle: t('common.back') }} />}
            {isInDrawer ? detail : <ScrollView>{detail}</ScrollView>}
        </View>
    );
});
