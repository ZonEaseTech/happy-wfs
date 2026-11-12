import * as React from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { VaultKeyKindSchema, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { DeviceManagementView } from '@/components/DeviceManagementView';
import { showToast } from '@/components/Toast';
import { openVaultAddKey } from '@/components/VaultAddKeyModal';
import { VaultKeyDetail } from '@/components/VaultKeyDetail';
import { VaultKeyIcon, VaultUsageList, vaultKindLabel } from '@/components/VaultSections';
import { useDesktopRoute, useDesktopRoutes, useDrawerHeaderRight } from '@/components/desktopRoutes';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useAllMachines } from '@/sync/storage';
import { refreshVault, useVault } from '@/sync/vault';
import { vaultCanDo, vaultSay } from '@/sync/vaultRules';

type Tab = 'keys' | 'usage' | 'devices';

/** Below this width the key list and a key's details no longer fit side by side. */
const TWO_COLUMNS = 760;
const RECENT = 7 * 24 * 3600 * 1000;

/**
 * Resource center: keys on the left and the selected key on the right, with the usage log
 * and the device list one tab away. Narrow screens show the list and open a key on its own page.
 */
export const ResourceCenterView = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { isInDrawer } = useDesktopRoute();
    const { open } = useDesktopRoutes();
    const vault = useVault();
    const machines = useAllMachines();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);

    const [tab, setTab] = React.useState<Tab>('keys');
    const [selected, setSelected] = React.useState<string | null>(null);
    const [usageFilter, setUsageFilter] = React.useState<string | null>(null);
    const [width, setWidth] = React.useState(0);
    const wide = width >= TWO_COLUMNS;
    const current = vault.keys.find((key) => key.id === selected) ?? vault.keys[0];
    // Drawers already scroll their content; a nested scroll view would collapse to zero height there.
    const scroll = (style: object, children: React.ReactNode, contentStyle?: object) => (isInDrawer
        ? <View style={[style, contentStyle]}>{children}</View>
        : <ScrollView style={style} contentContainerStyle={contentStyle} keyboardShouldPersistTaps="handled">{children}</ScrollView>);

    const addKey = React.useCallback((kind?: VaultKeyKind) => {
        openVaultAddKey(kind, (key) => {
            setTab('keys');
            setSelected(key.id);
            showToast(t('resources.savedToast', { say: vaultSay(key) }));
        });
    }, []);

    const addButton = React.useMemo(() => (
        <Pressable onPress={() => addKey()} hitSlop={8} accessibilityRole="button" style={styles.addButton}>
            <Text style={styles.addButtonText}>＋ {t('resources.addKey')}</Text>
        </Pressable>
    ), [addKey, styles]);
    useDrawerHeaderRight(addButton);

    const openKey = (key: VaultKey) => {
        if (wide) setSelected(key.id);
        else open(`/devices/key?id=${key.id}`, { title: key.name });
    };

    const list = (
        <>
            {vault.keys.map((key) => {
                const lastOk = vault.logs.find((entry) => entry.keyId === key.id && entry.outcome !== 'denied');
                const active = wide && current?.id === key.id;
                return (
                    <Pressable key={key.id} onPress={() => openKey(key)} style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && !active && styles.itemPressed]}>
                        <VaultKeyIcon kind={key.kind} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.itemName} numberOfLines={1}>{key.name}</Text>
                            <Text style={styles.itemSub} numberOfLines={1}>{vaultCanDo(key)}</Text>
                        </View>
                        <View style={[styles.dot, { backgroundColor: lastOk && Date.now() - lastOk.at < RECENT ? '#34C759' : theme.colors.divider }]} />
                    </Pressable>
                );
            })}
            <Pressable onPress={() => addKey()} style={styles.pasteRow}>
                <Text style={styles.pasteRowText}>＋ {t('resources.pasteAKey')}</Text>
            </Pressable>
        </>
    );

    const welcome = (
        <View style={styles.welcome}>
            <Text style={styles.welcomeTitle}>{t('resources.welcomeTitle')}</Text>
            <Text style={styles.welcomeText}>{t('resources.welcomeText')}</Text>
            <Pressable onPress={() => addKey()} style={styles.bigPaste}>
                <Text style={styles.bigPasteTitle}>{t('resources.pasteHere')}</Text>
                <Text style={styles.bigPasteHint}>{t('resources.pasteHint')}</Text>
            </Pressable>
            <View style={styles.tiles}>
                {VaultKeyKindSchema.options.map((kind) => (
                    <Pressable key={kind} onPress={() => addKey(kind)} style={[styles.tile, { width: wide ? '31.5%' : '48%' }]}>
                        <VaultKeyIcon kind={kind} size={34} />
                        <Text style={styles.tileName}>{vaultKindLabel(kind)}</Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );

    let body: React.ReactNode;
    if (tab === 'usage') {
        body = scroll(styles.fill, <View style={styles.page}><VaultUsageList logs={vault.logs} keys={vault.keys} initialFilter={usageFilter} /></View>);
    } else if (tab === 'devices') {
        body = <View style={styles.fill}><DeviceManagementView /></View>;
    } else if (vault.keys.length === 0) {
        body = scroll(styles.fill, welcome);
    } else if (wide && current) {
        body = (
            <View style={[styles.fill, styles.row]}>
                {scroll(styles.list, list, styles.listContent)}
                {scroll(styles.fill, (
                    <View style={styles.detail}>
                        <VaultKeyDetail
                            keyId={current.id}
                            onShowUsage={() => { setUsageFilter(current.id); setTab('usage'); }}
                            onDeleted={() => setSelected(null)}
                        />
                    </View>
                ))}
            </View>
        );
    } else {
        body = scroll(styles.fill, <View style={styles.page}>{list}</View>, styles.listContent);
    }

    const tabs: [Tab, string, number][] = [
        ['keys', t('resources.keys'), vault.keys.length],
        ['usage', t('resources.usage'), vault.logs.length],
        ['devices', t('resources.deviceSection'), machines.length],
    ];

    return (
        <View style={[styles.fill, { backgroundColor: theme.colors.surface }]} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
            {!isInDrawer && <Stack.Screen options={{ headerRight: () => addButton }} />}
            <View style={styles.tabsBar}>
                <View style={styles.tabs}>
                    {tabs.map(([value, label, count]) => (
                        <Pressable key={value} onPress={() => { setTab(value); if (value !== 'usage') setUsageFilter(null); }} style={[styles.tab, tab === value && styles.tabActive]}>
                            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>{label}<Text style={styles.tabCount}>{`  ${count}`}</Text></Text>
                        </Pressable>
                    ))}
                </View>
            </View>
            <View style={styles.fill}>{body}</View>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    fill: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
    },
    page: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
    },
    tabsBar: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    tabs: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        padding: 2,
        borderRadius: 9,
        backgroundColor: theme.colors.groupped.background,
    },
    tab: {
        paddingHorizontal: 14,
        paddingVertical: 5,
        borderRadius: 7,
    },
    tabActive: {
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    tabText: {
        ...Typography.default(),
        fontSize: 13.5,
        color: theme.colors.textSecondary,
    },
    tabTextActive: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    tabCount: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    list: {
        width: 280,
        flexGrow: 0,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
    },
    listContent: {
        padding: 10,
        gap: 4,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: 10,
    },
    itemActive: {
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    itemPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    itemName: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    itemSub: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    pasteRow: {
        marginTop: 6,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        alignItems: 'center',
    },
    pasteRowText: {
        ...Typography.default(),
        fontSize: 13.5,
        color: theme.colors.textSecondary,
    },
    detail: {
        width: '100%',
        maxWidth: 760,
    },
    welcome: {
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 32,
        gap: 8,
    },
    welcomeTitle: {
        ...Typography.default('semiBold'),
        fontSize: 18,
        color: theme.colors.text,
    },
    welcomeText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 21,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        marginBottom: 8,
    },
    bigPaste: {
        width: '100%',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 22,
        borderRadius: 14,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: '#93C5FD',
        backgroundColor: theme.dark ? 'rgba(59,130,246,0.08)' : '#F8FBFF',
    },
    bigPasteTitle: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: '#2563EB',
    },
    bigPasteHint: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    tiles: {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 8,
        marginTop: 8,
    },
    tile: {
        alignItems: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    tileName: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    addButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    addButtonText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textLink,
    },
}));
