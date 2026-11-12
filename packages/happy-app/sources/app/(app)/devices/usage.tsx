import * as React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useDesktopRoute, useRouteParams } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { VaultLogItem } from '@/components/VaultSections';
import { t } from '@/text';
import { refreshVault, useVault } from '@/sync/vault';

/** Resource center › usage log, optionally for one key (`?keyId=`). */
export default React.memo(function VaultUsageScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { keyId } = useRouteParams<{ keyId?: string }>();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);
    const entries = keyId ? vault.logs.filter((entry) => entry.keyId === keyId) : vault.logs;

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('resources.usage'), headerBackTitle: t('common.back') }} />}
            <ItemGroup footer={t('resources.usageFooter')}>
                {entries.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {entries.map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} />)}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});
