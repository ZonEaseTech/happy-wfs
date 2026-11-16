import * as React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { VaultKey } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { showCopiedToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { vaultFieldLabel } from '@/sync/vaultRules';

/**
 * Resource center › a key › Show secrets: the values this app already decrypted, shown to the
 * user who owns them so a forgotten password is never lost. Nothing here reaches a session; the
 * agent still only ever gets them injected into a command.
 */
export const VaultSecretsModal = React.memo(({ onClose, vaultKey }: { onClose: () => void; vaultKey: VaultKey }) => {
    const styles = stylesheet;
    const secrets = [
        ...(vaultKey.ssh ? [{ label: vaultKey.ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey'), name: `${vaultKey.ssh.user}@${vaultKey.ssh.host}`, value: vaultKey.ssh.secret }] : []),
        ...vaultKey.env.filter((v) => v.secret).map((v) => ({ label: vaultFieldLabel(v.name), name: v.name, value: v.value })),
    ];
    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title} numberOfLines={1}>{`${t('resources.viewSecrets')} · ${vaultKey.name}`}</Text>
                <Pressable onPress={onClose} hitSlop={10}><Text style={styles.close}>✕</Text></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={styles.body}>
                <Text style={styles.note}>{t('resources.viewSecretsNote')}</Text>
                {secrets.length === 0 && <Text style={styles.note}>{t('resources.noSecrets')}</Text>}
                {secrets.map((secret) => (
                    <View key={secret.name} style={styles.item}>
                        <View style={styles.itemHead}>
                            <Text style={styles.label}>{secret.label}</Text>
                            {secret.label !== secret.name && <Text style={styles.varName} numberOfLines={1}>{secret.name}</Text>}
                            <View style={{ flex: 1 }} />
                            <Pressable onPress={() => { void Clipboard.setStringAsync(secret.value).then(showCopiedToast); }} hitSlop={8}>
                                <Text style={styles.link}>{t('common.copy')}</Text>
                            </Pressable>
                        </View>
                        <ScrollView style={styles.valueBox} nestedScrollEnabled>
                            <Text style={styles.value} selectable>{secret.value}</Text>
                        </ScrollView>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
});

export function openVaultSecrets(vaultKey: VaultKey) {
    Modal.show({ component: VaultSecretsModal, props: { vaultKey } });
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
        width: 520,
        maxWidth: '100%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        ...Typography.default('semiBold'),
        flex: 1,
        fontSize: 16,
        color: theme.colors.text,
    },
    close: {
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    body: {
        padding: 18,
        gap: 14,
    },
    note: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textSecondary,
    },
    item: {
        gap: 6,
    },
    itemHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    varName: {
        ...Typography.mono(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textLink,
    },
    valueBox: {
        maxHeight: 160,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    value: {
        ...Typography.mono(),
        fontSize: 12.5,
        lineHeight: 18,
        color: theme.colors.text,
    },
}));
