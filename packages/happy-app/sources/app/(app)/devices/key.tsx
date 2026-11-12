import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { VaultKey } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { useDesktopRoute, useDesktopRoutes, useRouteParams } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { VaultKeyIcon, VaultLogItem, VaultSectionTitle, vaultKindLabel, vaultMachineName } from '@/components/VaultSections';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { deleteVaultKey, refreshVault, saveVaultKey, useVault } from '@/sync/vault';
import { formatLastSeen } from '@/utils/sessionUtils';

/** Resource center › one key. Secrets are never shown; they can only be replaced. */
export default React.memo(function VaultKeyScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { isInDrawer, dismiss } = useDesktopRoute();
    const { open } = useDesktopRoutes();
    const { id } = useRouteParams<{ id?: string }>();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);
    const key = vault.keys.find((candidate) => candidate.id === id);

    const [rotating, rotate] = useHappyAction(async () => {
        if (!key) return;
        const values = new Map<string, string>();
        for (const name of key.ssh ? ['ssh'] : key.env.filter((v) => v.secret).map((v) => v.name)) {
            const label = name === 'ssh' ? (key.ssh!.auth === 'password' ? t('resources.authPassword') : t('resources.authKey')) : name;
            const next = await Modal.prompt(`${t('resources.rotate')} · ${label}`, t('resources.rotateHint'), {
                inputType: key.ssh?.auth === 'key' ? undefined : 'secure-text',
                multiline: key.ssh?.auth === 'key',
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
            });
            if (next === null) return;
            if (!next.trim()) throw new Error(t('resources.secretRequired'));
            values.set(name, next.trim());
        }
        await saveVaultKey({
            ...key,
            env: key.env.map((v) => ({ ...v, value: values.get(v.name) ?? v.value })),
            ssh: key.ssh ? { ...key.ssh, secret: values.get('ssh') ?? key.ssh.secret } : null,
        }, key);
    });

    /** Allow/deny rules are edited in place and saved right away. */
    const saveRules = async (patch: Pick<Partial<VaultKey>, 'allow' | 'deny'>) => {
        if (!key) return;
        try {
            await saveVaultKey({ ...key, ...patch }, key);
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    };
    const addRule = async (list: 'allow' | 'deny') => {
        if (!key) return;
        const rule = (await Modal.prompt(list === 'allow' ? t('resources.addAllowTitle') : t('resources.addDenyTitle'), t('resources.rulePrompt'), {
            confirmText: t('resources.add'),
            cancelText: t('common.cancel'),
        }))?.trim();
        if (rule && !key[list].includes(rule)) await saveRules({ [list]: [...key[list], rule] });
    };
    const removeRule = (list: 'allow' | 'deny', rule: string) => {
        if (key) void saveRules({ [list]: key[list].filter((candidate) => candidate !== rule) });
    };
    const removeButton = (onPress: () => void) => (
        <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
            <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>{t('resources.remove')}</Text>
        </Pressable>
    );

    const [deleting, remove] = useHappyAction(async () => {
        if (!key) return;
        const confirmed = await Modal.confirm(t('resources.deleteKey'), t('resources.deleteConfirm', { name: key.name }), {
            confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true,
        });
        if (!confirmed) return;
        await deleteVaultKey(key);
        dismiss();
    });

    if (!key) {
        return <ItemList>{!isInDrawer && <Stack.Screen options={{ headerTitle: t('resources.keys') }} />}</ItemList>;
    }

    const example = key.ssh
        ? `happy run ${key.slug} -- uptime`
        : `happy run ${key.slug} -- ${key.allow.find((rule) => rule !== '*')?.replace(/\*/g, '').trim() || '<command>'}`;
    const logs = vault.logs.filter((entry) => entry.keyId === key.id);

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: key.name, headerBackTitle: t('common.back') }} />}
            <ItemGroup>
                <Item
                    title={key.name}
                    subtitle={`${vaultKindLabel(key.kind)} · ${t('resources.nameInCommand')} ${key.slug} · ${t('resources.updated', { when: formatLastSeen(key.updatedAt) })}`}
                    subtitleLines={2}
                    icon={<VaultKeyIcon kind={key.kind} />}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('resources.howToUse')} footer={t('resources.howToUseFooter')}>
                <View style={styles.codeBox}>
                    <Text style={styles.code} selectable>{example}</Text>
                </View>
            </ItemGroup>

            {key.ssh ? (
                <ItemGroup title={t('resources.login')} footer={t('resources.viaFooter')}>
                    <Item title={t('resources.host')} detail={`${key.ssh.user}@${key.ssh.host}:${key.ssh.port}`} showChevron={false} />
                    <Item title={key.ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey')} detail={t('resources.secretSaved')} showChevron={false} />
                    <Item title={t('resources.via')} detail={vaultMachineName(key.ssh.viaMachineId)} showChevron={false} />
                </ItemGroup>
            ) : (
                <ItemGroup title={t('resources.secrets')}>
                    {key.env.map((v) => (
                        <Item key={v.name} title={v.name} titleStyle={styles.mono} detail={v.secret ? t('resources.secretSaved') : v.value} showChevron={false} />
                    ))}
                </ItemGroup>
            )}

            <ItemGroup
                title={<VaultSectionTitle title={t('resources.allow')} link={`＋ ${t('resources.add')}`} onLink={() => { void addRule('allow'); }} />}
                footer={t('resources.allowFooter')}
            >
                {key.allow.length === 0 && <Item title={t('resources.emptyAllow')} showChevron={false} />}
                {key.allow.map((rule) => (
                    <Item key={rule} title={rule} titleStyle={styles.mono} rightElement={removeButton(() => removeRule('allow', rule))} showChevron={false} />
                ))}
            </ItemGroup>
            <ItemGroup
                title={<VaultSectionTitle title={t('resources.deny')} link={`＋ ${t('resources.add')}`} onLink={() => { void addRule('deny'); }} />}
                footer={t('resources.denyFooter')}
            >
                {key.deny.length === 0 && <Item title={t('resources.emptyRules')} showChevron={false} />}
                {key.deny.map((rule) => (
                    <Item key={rule} title={rule} titleStyle={[styles.mono, { color: theme.colors.textDestructive }]} rightElement={removeButton(() => removeRule('deny', rule))} showChevron={false} />
                ))}
            </ItemGroup>
            <ItemGroup title={t('resources.scope')} footer={t('resources.scopeFooter')}>
                {key.scope.length === 0 && <Item title={t('resources.emptyRules')} showChevron={false} />}
                {key.scope.map((scope) => (
                    <Item
                        key={scope.name}
                        title={scope.name}
                        titleStyle={styles.scopeName}
                        subtitle={scope.protected ? (
                            <>
                                <Text style={styles.protectedTag}>{` ${t('resources.doNotTouchTag')} `}</Text>
                                {` ${scope.protected}`}
                            </>
                        ) : undefined}
                        subtitleLines={0}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
            {!key.ssh && (
                <ItemGroup title={t('resources.devices')} footer={t('resources.devicesFooter')}>
                    <Item title={key.machineIds.map(vaultMachineName).join('、') || t('resources.emptyRules')} showChevron={false} />
                </ItemGroup>
            )}

            <ItemGroup>
                <Item title={t('resources.edit')} icon={<Ionicons name="create-outline" size={29} color={theme.colors.textLink} />} onPress={() => open(`/devices/key-edit?id=${key.id}`, { title: t('resources.editKey') })} />
                <Item title={t('resources.rotate')} icon={<Ionicons name="refresh-outline" size={29} color={theme.colors.textLink} />} loading={rotating} onPress={rotate} showChevron={false} />
                <Item title={t('resources.deleteKey')} icon={<Ionicons name="trash-outline" size={29} color={theme.colors.textDestructive} />} destructive loading={deleting} onPress={remove} showChevron={false} />
            </ItemGroup>

            <ItemGroup
                title={(
                    <VaultSectionTitle
                        title={t('resources.keyUsage')}
                        link={logs.length > 20 ? t('resources.all') : undefined}
                        onLink={() => open(`/devices/usage?keyId=${key.id}`, { title: t('resources.usage') })}
                    />
                )}
                footer={t('resources.usageFooter')}
            >
                {logs.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {logs.slice(0, 20).map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} />)}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    codeBox: {
        backgroundColor: '#0F172A',
        borderRadius: 10,
        padding: 12,
        maxWidth: layout.maxWidth,
    },
    code: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
        lineHeight: 19,
        color: '#E5E7EB',
    },
    mono: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
    },
    scopeName: {
        fontWeight: '600',
    },
    protectedTag: {
        color: theme.colors.textDestructive,
        backgroundColor: theme.dark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
        fontWeight: '600',
        fontSize: 12.5,
    },
}));
