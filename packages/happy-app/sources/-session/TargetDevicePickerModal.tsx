import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { encodeBase64 } from '@/encryption/base64';
import type { Machine } from '@/sync/storageTypes';

export type TargetDeviceSelection = Array<{ id: string; name: string; key: string | null }>;

function deviceName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 12);
}

/**
 * Every machine whose data key this client can hand to the CLI. A machine
 * without one cannot be targeted at all — the CLI has no way to open its key
 * envelope, so it needs the key passed through session metadata.
 */
export function selectableTargetDevices(machines: Machine[]): TargetDeviceSelection {
    return machines
        .map((machine) => ({ machine, key: sync.getMachineDataKey(machine.id) }))
        .filter(({ key }) => key)
        .map(({ machine, key }) => ({ id: machine.id, name: deviceName(machine), key: encodeBase64(key!) }));
}

/**
 * Multi-select target devices for a session. "This session's machine" is the
 * empty selection; picking devices hands their keys to the CLI so it can run
 * commands on them.
 */
export const TargetDevicePickerModal = React.memo(({ machines, initialSelected, onSubmit, onClose }: {
    machines: Machine[];
    initialSelected: string[];
    onSubmit: (devices: TargetDeviceSelection) => void;
    onClose: () => void;
}) => {
    const { theme } = useUnistyles();
    const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialSelected));

    const options = React.useMemo(() => [...machines]
        .sort((a, b) => Number(b.active) - Number(a.active))
        .map((machine) => ({
            machine,
            name: deviceName(machine),
            key: sync.getMachineDataKey(machine.id),
        })), [machines]);
    const selectableIds = React.useMemo(() => options.filter((option) => option.key).map((option) => option.machine.id), [options]);

    const toggle = React.useCallback((machineId: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(machineId)) next.delete(machineId); else next.add(machineId);
            return next;
        });
    }, []);
    const selectAll = React.useCallback(() => setSelected(new Set(selectableIds)), [selectableIds]);
    const invert = React.useCallback(() => {
        setSelected((current) => new Set(selectableIds.filter((id) => !current.has(id))));
    }, [selectableIds]);

    const submit = React.useCallback(() => {
        onSubmit(options
            .filter((option) => selected.has(option.machine.id) && option.key)
            .map((option) => ({ id: option.machine.id, name: option.name, key: option.key ? encodeBase64(option.key) : null })));
        onClose();
    }, [onClose, onSubmit, options, selected]);

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
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
                <Text style={{ flex: 1, color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>
                    {t('devices.selectDevice')}
                </Text>
                <Pressable onPress={selectAll} hitSlop={8}>
                    <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t('devices.selectAllDevices')}</Text>
                </Pressable>
                <Pressable onPress={invert} hitSlop={8}>
                    <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t('devices.invertDevices')}</Text>
                </Pressable>
            </View>
            <Pressable
                onPress={() => setSelected(new Set())}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
            >
                <Ionicons
                    name={selected.size === 0 ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected.size === 0 ? theme.colors.textLink : theme.colors.textSecondary}
                />
                <Text style={{ color: theme.colors.text, fontSize: 15 }}>{t('devices.useSessionMachine')}</Text>
            </Pressable>
            <ScrollView style={{ maxHeight: 300 }}>
                {options.map(({ machine, name, key }) => {
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
                                <Text style={{ color: theme.colors.text, fontSize: 15 }} numberOfLines={1}>{name}</Text>
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
                <Pressable onPress={submit} hitSlop={8}>
                    <Text style={{ fontSize: 15, color: theme.colors.textLink, fontWeight: '600' }}>
                        {t('common.save')}{selected.size > 0 ? ` (${selected.size})` : ''}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});
