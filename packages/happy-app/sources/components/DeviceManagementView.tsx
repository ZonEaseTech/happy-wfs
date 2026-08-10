import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
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
import { openTerminalPanel } from '@/components/terminalPanelStore';
import { DeviceMcpShareModal } from '@/components/DeviceMcpShareModal';
import { renameDevicePublicLabel, approveDeviceKeyRequest, buildEnrollCommand, createDeviceEnrollToken, deleteDevice, denyDeviceKeyRequest, listDeviceKeyRequests, setMachineDeviceFlag, type DeviceDirectoryEntry, type DeviceKeyRequest } from '@/sync/apiDevices';
import { sync } from '@/sync/sync';
import { encodeBase64 } from '@/encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { useAllMachines } from '@/sync/storage';
import { machineUpdateMetadata } from '@/sync/ops';
import { Terminal } from '@/components/Terminal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { ActionMenuModal } from '@/components/ActionMenuModal';
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
    const [menuDevice, setMenuDevice] = React.useState<Machine | null>(null);
    // Desktop web has room for inline row actions; phones keep the tap-to-open
    // action sheet.
    const { width: windowWidth } = useWindowDimensions();
    const showInlineActions = Platform.OS === 'web' && windowWidth >= 900;
    const [keyRequests, setKeyRequests] = React.useState<DeviceKeyRequest[]>([]);

    // Poll for `happy ssh` authorization requests: they are short-lived and the
    // user is usually staring at this screen waiting to approve one.
    React.useEffect(() => {
        if (!auth.credentials) return;
        const credentials = auth.credentials;
        let cancelled = false;
        const load = () => {
            listDeviceKeyRequests(credentials)
                .then((requests) => { if (!cancelled) setKeyRequests(requests.filter((request) => !request.approved)); })
                .catch(() => { });
        };
        load();
        const interval = setInterval(load, 5000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [auth.credentials]);

    const handleApproveKeyRequest = React.useCallback(async (request: DeviceKeyRequest) => {
        if (!auth.credentials) return;
        // Hand over the whole directory: device names are encrypted per machine,
        // so a CLI holding a single key could not render a readable list.
        const directory = machines
            .map((machine) => {
                const material = sync.getMachineKeyMaterial(machine.id);
                return material
                    ? { id: machine.id, name: machineTitle(machine), key: encodeBase64(material.key), variant: material.variant }
                    : null;
            })
            .filter((entry): entry is DeviceDirectoryEntry => !!entry);
        if (directory.length === 0) {
            Modal.alert(t('common.error'), t('devices.approveNoKey'));
            return;
        }
        try {
            await approveDeviceKeyRequest(auth.credentials, request, directory);
            setKeyRequests((current) => current.filter((item) => item.id !== request.id));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [auth.credentials, machines]);

    const handleDenyKeyRequest = React.useCallback(async (request: DeviceKeyRequest) => {
        if (!auth.credentials) return;
        try {
            await denyDeviceKeyRequest(auth.credentials, request.id);
            setKeyRequests((current) => current.filter((item) => item.id !== request.id));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [auth.credentials]);

    const handleRenameDevice = React.useCallback(async (machine: Machine) => {
        if (!machine.metadata) return;
        const next = await Modal.prompt(t('devices.renameTitle'), t('devices.renameHint'), {
            defaultValue: machine.metadata.displayName || machine.metadata.host || '',
            confirmText: t('common.save'),
            cancelText: t('common.cancel'),
        });
        if (next === null) return;
        try {
            await machineUpdateMetadata(
                machine.id,
                { ...machine.metadata, displayName: next.trim() || undefined },
                machine.metadataVersion,
            );
            if (auth.credentials) {
                await renameDevicePublicLabel(auth.credentials, machine.id, next.trim() || null);
            }
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [auth.credentials]);

    const handleDeleteDevice = React.useCallback(async (machine: Machine) => {
        const name = machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 12);
        const confirmed = await Modal.confirm(
            t('devices.deleteDeviceTitle'),
            t('devices.deleteDeviceConfirm', { name }),
            { confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true },
        );
        if (!confirmed) return;
        if (!auth.credentials) {
            Modal.alert(t('common.error'), t('devices.needLogin'));
            return;
        }
        try {
            await deleteDevice(auth.credentials, machine.id);
            await sync.refreshMachines();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [auth.credentials]);

    const deviceMenuItems = React.useMemo<ActionMenuItem[]>(() => {
        if (!menuDevice) return [];
        return [
            {
                label: t('devices.openTerminal'),
                onPress: () => { const device = menuDevice; setMenuDevice(null); openTerminalPanel({ targetId: device.id, isMachineScope: true }); },
            },
            {
                label: menuDevice.isDevice ? t('devices.allowSessions') : t('devices.markAsDevice'),
                onPress: () => {
                    const device = menuDevice;
                    setMenuDevice(null);
                    if (!auth.credentials) return;
                    setMachineDeviceFlag(auth.credentials, device.id, !device.isDevice).catch((error) => {
                        Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
                    });
                },
            },
            {
                label: t('devices.rename'),
                onPress: () => { const device = menuDevice; setMenuDevice(null); void handleRenameDevice(device); },
            },
            {
                label: t('devices.deleteDevice'),
                destructive: true,
                onPress: () => { const device = menuDevice; setMenuDevice(null); void handleDeleteDevice(device); },
            },
        ];
    }, [handleDeleteDevice, handleRenameDevice, menuDevice]);

    const sortedMachines = React.useMemo(
        () => [...machines].sort((a, b) => Number(b.active) - Number(a.active) || machineTitle(a).localeCompare(machineTitle(b))),
        [machines],
    );

    const handleShareMcp = React.useCallback(() => {
        Modal.show({
            component: DeviceMcpShareModal,
            props: { machines: sortedMachines, machineTitle },
        });
    }, [sortedMachines]);


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
            // Prompt (not confirm) so the long one-liner gets a wide, scrollable,
            // selectable field instead of being squeezed into an alert body.
            const confirmed = await Modal.prompt(t('devices.enrollTitle'), t('devices.enrollHint'), {
                defaultValue: command,
                confirmText: t('common.copy'),
                cancelText: t('common.cancel'),
                multiline: true,
                multilineRows: 4,
                size: 'large',
            });
            if (confirmed) {
                await Clipboard.setStringAsync(confirmed.trim() || command);
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
                    title={t('devices.shareMcp')}
                    icon={<Ionicons name="share-social-outline" size={29} color={theme.colors.textLink} />}
                    onPress={handleShareMcp}
                    showChevron={false}
                />
                <Item
                    title={t('devices.addDevice')}
                    icon={creating
                        ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        : <Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    onPress={() => { void handleAddDevice(); }}
                    showChevron={false}
                />
            </ItemGroup>

            {keyRequests.length > 0 && (
                <ItemGroup title={t('devices.pendingApprovals')} footer={t('devices.pendingApprovalsFooter')}>
                    {keyRequests.map((request) => {
                        const machine = machines.find((candidate) => candidate.id === request.machineId);
                        return (
                            <Item
                                key={request.id}
                                title={machine ? machineTitle(machine) : request.machineId.slice(0, 12)}
                                subtitle={request.label ?? undefined}
                                icon={<Ionicons name="key-outline" size={29} color={theme.colors.textLink} />}
                                rightElement={(
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                        <Pressable onPress={() => { void handleApproveKeyRequest(request); }} hitSlop={8}>
                                            <Text style={{ fontSize: 15, color: theme.colors.textLink }}>{t('devices.approve')}</Text>
                                        </Pressable>
                                        <Pressable onPress={() => { void handleDenyKeyRequest(request); }} hitSlop={8}>
                                            <Text style={{ fontSize: 15, color: theme.colors.textDestructive }}>{t('devices.deny')}</Text>
                                        </Pressable>
                                    </View>
                                )}
                                showChevron={false}
                            />
                        );
                    })}
                </ItemGroup>
            )}

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
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: showInlineActions ? 14 : 6 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <View style={[styles.statusDot, { backgroundColor: machine.active ? '#16A34A' : theme.colors.textSecondary }]} />
                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                            {machine.active ? t('devices.online') : t('devices.offline')}
                                        </Text>
                                    </View>
                                    {showInlineActions && (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                            <Pressable
                                                onPress={() => openTerminalPanel({ targetId: machine.id, isMachineScope: true })}
                                                hitSlop={8}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('devices.openTerminal')}
                                            >
                                                <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t('devices.openTerminal')}</Text>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => { void handleRenameDevice(machine); }}
                                                hitSlop={8}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('devices.rename')}
                                            >
                                                <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t('devices.rename')}</Text>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => { void handleDeleteDevice(machine); }}
                                                hitSlop={8}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('devices.deleteDevice')}
                                            >
                                                <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>{t('devices.deleteDevice')}</Text>
                                            </Pressable>
                                        </View>
                                    )}
                                </View>
                            )}
                            onPress={showInlineActions ? undefined : () => setMenuDevice(machine)}
                            showChevron={!showInlineActions}
                        />
                    ))}
                </ItemGroup>
            )}

            <ActionMenuModal
                visible={!!menuDevice}
                items={deviceMenuItems}
                onClose={() => setMenuDevice(null)}
                title={menuDevice ? machineTitle(menuDevice) : undefined}
            />
        </ScrollView>
    );
});
