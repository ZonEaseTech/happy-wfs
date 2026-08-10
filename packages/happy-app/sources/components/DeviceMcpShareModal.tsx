import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { encodeBase64 } from '@/encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { buildDeviceMcpConfig, createDeviceShare } from '@/sync/apiDevices';
import { useAuth } from '@/auth/AuthContext';
import type { Machine } from '@/sync/storageTypes';

/**
 * Pick any number of enrolled devices and mint one hosted-MCP token covering
 * all of them. Devices whose key this client cannot resolve are listed but
 * not selectable — the server needs that key to drive them.
 */
export const DeviceMcpShareModal = React.memo(({ machines, machineTitle, onClose }: {
    machines: Machine[];
    machineTitle: (machine: Machine) => string;
    onClose: () => void;
}) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [busy, setBusy] = React.useState(false);

    const options = React.useMemo(() => machines.map((machine) => ({
        machine,
        key: sync.getMachineDataKey(machine.id),
    })), [machines]);

    const toggle = React.useCallback((machineId: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(machineId)) next.delete(machineId); else next.add(machineId);
            return next;
        });
    }, []);

    const handleGenerate = React.useCallback(async () => {
        if (busy || selected.size === 0) return;
        if (!auth.credentials) {
            Modal.alert(t('common.error'), t('devices.needLogin'));
            return;
        }
        const confirmed = await Modal.confirm(
            t('devices.shareMcp'),
            t('devices.shareMcpWarning'),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            const devices = options
                .filter((option) => selected.has(option.machine.id) && option.key)
                .map((option) => ({ machineId: option.machine.id, deviceKey: encodeBase64(option.key!) }));
            const share = await createDeviceShare(auth.credentials, devices, { label: `${devices.length} devices` });
            const config = buildDeviceMcpConfig(getServerUrl(), share.token);
            onClose();
            await Modal.prompt(t('devices.shareMcpTitle'), t('devices.shareMcpHint'), {
                defaultValue: config,
                confirmText: t('common.copy'),
                cancelText: t('common.cancel'),
                multiline: true,
                multilineRows: 10,
                size: 'large',
            });
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [auth.credentials, busy, onClose, options, selected]);

    return (
        <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            overflow: 'hidden',
            width: 420,
            maxWidth: '100%',
            maxHeight: 520,
        }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16 }}>
                {t('devices.shareMcp')}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}>
                {t('devices.shareMcpPickHint')}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
                {options.map(({ machine, key }) => {
                    const disabled = !key;
                    const isSelected = selected.has(machine.id);
                    return (
                        <Pressable
                            key={machine.id}
                            onPress={() => { if (!disabled) toggle(machine.id); }}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 12,
                                paddingHorizontal: 16,
                                paddingVertical: 12,
                                opacity: disabled ? 0.4 : 1,
                            }}
                        >
                            <Ionicons
                                name={isSelected ? 'checkbox' : 'square-outline'}
                                size={20}
                                color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                            />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 15 }} numberOfLines={1}>
                                    {machineTitle(machine)}
                                </Text>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                                    {machine.active ? t('devices.online') : t('devices.offline')}
                                    {disabled ? ` · ${t('devices.approveNoKey')}` : ''}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, padding: 16, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                <Pressable onPress={onClose} hitSlop={8}>
                    <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={() => { void handleGenerate(); }} hitSlop={8} disabled={selected.size === 0 || busy}>
                    <Text style={{ fontSize: 15, color: selected.size === 0 || busy ? theme.colors.textSecondary : theme.colors.textLink, fontWeight: '600' }}>
                        {t('devices.shareMcp')}{selected.size > 0 ? ` (${selected.size})` : ''}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});
