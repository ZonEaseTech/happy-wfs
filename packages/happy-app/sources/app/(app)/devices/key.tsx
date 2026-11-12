import * as React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { useDesktopRoute, useDesktopRoutes, useRouteParams } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { VaultLogItem, vaultKeyIcon, vaultKindLabel, vaultMachineName } from '@/components/VaultSections';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { deleteVaultKey, refreshVault, saveVaultKey, useVault } from '@/sync/vault';

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
                <Item title={key.name} subtitle={`${vaultKindLabel(key.kind)} · ${key.slug}`} icon={vaultKeyIcon(key, theme.colors.textSecondary)} showChevron={false} />
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

            <ItemGroup title={t('resources.allow')} footer={t('resources.allowFooter')}>
                {key.allow.length === 0 && <Item title={t('resources.emptyAllow')} showChevron={false} />}
                {key.allow.map((rule) => <Item key={rule} title={rule} titleStyle={styles.mono} showChevron={false} />)}
            </ItemGroup>
            <ItemGroup title={t('resources.deny')} footer={t('resources.denyFooter')}>
                {key.deny.length === 0 && <Item title={t('resources.emptyRules')} showChevron={false} />}
                {key.deny.map((rule) => <Item key={rule} title={rule} titleStyle={[styles.mono, { color: theme.colors.textDestructive }]} showChevron={false} />)}
            </ItemGroup>
            {key.scope.length > 0 && (
                <ItemGroup title={t('resources.scope')} footer={t('resources.scopeFooter')}>
                    {key.scope.map((scope) => (
                        <Item key={scope.name} title={scope.name} subtitle={scope.protected ? t('resources.doNotTouch', { what: scope.protected }) : undefined} showChevron={false} />
                    ))}
                </ItemGroup>
            )}
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

            <ItemGroup title={t('resources.usage')} footer={t('resources.usageFooter')}>
                {logs.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {logs.slice(0, 20).map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} />)}
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    codeBox: {
        backgroundColor: theme.colors.surfaceHigh,
        padding: 12,
        maxWidth: layout.maxWidth,
    },
    code: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.text,
    },
    mono: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
    },
}));
