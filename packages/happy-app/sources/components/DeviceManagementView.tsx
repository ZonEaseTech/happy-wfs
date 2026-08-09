import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { hapticsLight } from '@/components/haptics';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { layout } from '@/components/layout';
import { showCopiedToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { buildEnrollCommand, createDeviceEnrollToken } from '@/sync/apiDevices';
import { getServerUrl } from '@/sync/serverConfig';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingBottom: 24,
    },
    emptyContainer: {
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 40,
    },
    emptyTitle: {
        fontSize: 20,
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        marginTop: 12,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 15,
        ...Typography.default(),
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    commandBox: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
        marginTop: 8,
    },
    commandText: {
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.text,
        fontFamily: 'IBMPlexMono-Regular',
    },
    hint: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 19,
        marginTop: 10,
    },
}));

function machineTitle(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 12);
}

function machineSubtitle(machine: Machine): string {
    const parts = [
        machine.metadata?.platform,
        machine.metadata?.arch,
        machine.metadata?.happyCliVersion ? `CLI ${machine.metadata.happyCliVersion}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
}

/**
 * Devices are ordinary Happy machines — anything that ran the enrollment
 * one-liner shows up here with the live online state the daemon already
 * reports, so no separate inventory has to be kept in sync.
 */
export const DeviceManagementView = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const auth = useAuth();
    const machines = useAllMachines();
    const [creating, setCreating] = React.useState(false);

    const sortedMachines = React.useMemo(
        () => [...machines].sort((a, b) => Number(b.active) - Number(a.active) || machineTitle(a).localeCompare(machineTitle(b))),
        [machines],
    );

    const handleAddDevice = React.useCallback(async () => {
        if (creating) return;
        if (!auth.credentials?.token || !auth.credentials?.secret) {
            Modal.alert(t('common.error'), t('devices.needLogin'));
            return;
        }
        setCreating(true);
        try {
            const { token } = await createDeviceEnrollToken(auth.credentials, auth.credentials.secret);
            const command = buildEnrollCommand(token, getServerUrl());
            const copy = await Modal.confirm(t('devices.enrollTitle'), `${t('devices.enrollHint')}\n\n${command}`, {
                confirmText: t('common.copy'),
                cancelText: t('common.cancel'),
            });
            if (copy) {
                await Clipboard.setStringAsync(command);
                hapticsLight();
                showCopiedToast();
            }
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setCreating(false);
        }
    }, [auth.credentials, creating]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <ItemGroup title={t('devices.addDeviceTitle')} footer={t('devices.addDeviceFooter')}>
                <Item
                    title={t('devices.addDevice')}
                    icon={creating
                        ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        : <Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    onPress={() => { void handleAddDevice(); }}
                    showChevron={false}
                />
            </ItemGroup>

            {sortedMachines.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="hardware-chip-outline" size={44} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyTitle}>{t('devices.emptyTitle')}</Text>
                    <Text style={styles.emptyDescription}>{t('devices.emptyDescription')}</Text>
                </View>
            ) : (
                <ItemGroup title={t('devices.deviceList')}>
                    {sortedMachines.map((machine) => (
                        <Item
                            key={machine.id}
                            title={machineTitle(machine)}
                            subtitle={machineSubtitle(machine)}
                            icon={<Ionicons name="hardware-chip-outline" size={29} color={theme.colors.textSecondary} />}
                            rightElement={(
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <View style={[styles.statusDot, { backgroundColor: machine.active ? '#16A34A' : theme.colors.textSecondary }]} />
                                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                        {machine.active ? t('devices.online') : t('devices.offline')}
                                    </Text>
                                </View>
                            )}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}
        </ScrollView>
    );
});
