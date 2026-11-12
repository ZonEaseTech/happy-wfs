import * as React from 'react';
import { View } from 'react-native';
import { layout } from '@/components/layout';
import { Stack } from 'expo-router';
import { useDesktopRoute, useRouteParams } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { VaultChip, VaultLogItem } from '@/components/VaultSections';
import { t } from '@/text';
import { refreshVault, useVault } from '@/sync/vault';

/** Resource center › usage log, filtered by all / refused / one key (`?keyId=` preselects a key). */
export default React.memo(function VaultUsageScreen() {
    const { isInDrawer } = useDesktopRoute();
    const { keyId } = useRouteParams<{ keyId?: string }>();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);
    const [filter, setFilter] = React.useState<string>(keyId ?? 'all');

    // A key that was deleted still has entries; name it from the entries themselves.
    const keyFilters = React.useMemo(() => {
        const names = new Map<string, string>();
        for (const entry of vault.logs) if (!names.has(entry.keyId)) names.set(entry.keyId, entry.keyName);
        return [...names.entries()].map(([id, name]) => ({ id, name: vault.keys.find((key) => key.id === id)?.name ?? name }));
    }, [vault.logs, vault.keys]);
    const denied = vault.logs.filter((entry) => entry.outcome === 'denied').length;
    const entries = vault.logs.filter((entry) => filter === 'all' || (filter === 'denied' ? entry.outcome === 'denied' : entry.keyId === filter));

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: t('resources.usage'), headerBackTitle: t('common.back') }} />}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 14, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' }}>
                <VaultChip label={t('resources.filterAll', { count: vault.logs.length })} selected={filter === 'all'} onPress={() => setFilter('all')} />
                <VaultChip label={t('resources.filterDenied', { count: denied })} selected={filter === 'denied'} onPress={() => setFilter('denied')} />
                {keyFilters.map((key) => (
                    <VaultChip key={key.id} label={key.name} selected={filter === key.id} onPress={() => setFilter(key.id)} />
                ))}
            </View>
            <ItemGroup footer={t('resources.usageFooter')}>
                {entries.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {entries.map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} />)}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});
