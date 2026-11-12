import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { isVaultCommandLearnable, type VaultKey, type VaultKeyKind, type VaultUsageLog } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { useDesktopRoutes } from '@/components/desktopRoutes';
import { showToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { refreshVault, saveVaultKey, useVault } from '@/sync/vault';

export const vaultKindLabel = (kind: VaultKeyKind): string => ({
    cloudflare: t('resources.kindCloudflare'),
    aliyun: t('resources.kindAliyun'),
    github: t('resources.kindGithub'),
    npm: t('resources.kindNpm'),
    ssh: t('resources.kindSsh'),
    custom: t('resources.kindCustom'),
})[kind];

export function vaultMachineName(machineId: string): string {
    const machine = storage.getState().machines[machineId];
    return machine?.metadata?.displayName || machine?.metadata?.host || machineId.slice(0, 8);
}

export const vaultKeyIcon = (key: Pick<VaultKey, 'kind'>, color: string) => (
    <Ionicons name={key.kind === 'ssh' ? 'server-outline' : 'key-outline'} size={29} color={color} />
);

/** One usage entry. A refused command that is merely not on the allow list can be allowed in one tap. */
export const VaultLogItem = React.memo(({ entry, keys }: { entry: VaultUsageLog; keys: VaultKey[] }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const key = keys.find((candidate) => candidate.id === entry.keyId);
    const learnable = !!key && entry.outcome === 'denied' && isVaultCommandLearnable(key, entry.command) && !key.allow.includes(entry.command);
    const outcome = entry.outcome === 'ok'
        ? t('resources.outcomeOk')
        : entry.outcome === 'failed'
            ? `${t('resources.outcomeFailed')} · ${entry.exitCode ?? '?'}`
            : `${t('resources.outcomeDenied')}: ${t(entry.reason === 'guard' ? 'resources.reasonGuard' : entry.reason === 'deny' ? 'resources.reasonDeny' : 'resources.reasonNotAllowed')}`;
    const color = entry.outcome === 'ok' ? '#16A34A' : entry.outcome === 'failed' ? theme.colors.textDestructive : '#B45309';

    const allow = async () => {
        if (!key) return;
        try {
            await saveVaultKey({ ...key, allow: [...key.allow, entry.command] }, key);
            showToast(t('resources.commandAllowed', { command: entry.command }));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <Item
            title={entry.command}
            titleStyle={styles.command}
            subtitle={`${entry.keyName} · ${vaultMachineName(entry.machineId)} · ${new Date(entry.at).toLocaleString()}`}
            subtitleLines={2}
            rightElement={(
                <View style={styles.right}>
                    <Text style={[styles.outcome, { color }]} numberOfLines={2}>{outcome}</Text>
                    {learnable && (
                        <Pressable onPress={() => { void allow(); }} hitSlop={8} accessibilityRole="button">
                            <Text style={styles.allow}>{t('resources.allowThis')}</Text>
                        </Pressable>
                    )}
                </View>
            )}
            showChevron={false}
        />
    );
});

/** The resource center's own sections, shown under the device list. */
export const VaultSections = React.memo(() => {
    const { theme } = useUnistyles();
    const { open } = useDesktopRoutes();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);

    return (
        <>
            <ItemGroup title={t('resources.keys')} footer={t('resources.keysFooter')}>
                {vault.keys.map((key) => (
                    <Item
                        key={key.id}
                        title={key.name}
                        subtitle={t('resources.keySubtitle', { slug: key.slug, devices: key.ssh ? 1 : key.machineIds.length })}
                        icon={vaultKeyIcon(key, theme.colors.textSecondary)}
                        onPress={() => open(`/devices/key?id=${key.id}`, { title: key.name })}
                    />
                ))}
                <Item
                    title={t('resources.addKey')}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    onPress={() => open('/devices/key-edit', { title: t('resources.newKey') })}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('resources.usage')} footer={t('resources.usageFooter')}>
                {vault.logs.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {vault.logs.slice(0, 3).map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} />)}
                {vault.logs.length > 3 && (
                    <Item title={t('resources.usageAll')} onPress={() => open('/devices/usage', { title: t('resources.usage') })} />
                )}
            </ItemGroup>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    command: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
    },
    right: {
        alignItems: 'flex-end',
        gap: 4,
        maxWidth: 220,
    },
    outcome: {
        fontSize: 12,
        textAlign: 'right',
    },
    allow: {
        fontSize: 13,
        color: theme.colors.textLink,
    },
}));
