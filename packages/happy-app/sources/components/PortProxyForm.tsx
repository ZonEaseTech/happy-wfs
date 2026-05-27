import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { layout } from '@/components/layout';
import { showCopiedToast, showToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useAuth } from '@/auth/AuthContext';
import { buildPortProxyUrl, createPortProxy, updatePortProxy, type PortProxyRecord } from '@/sync/apiPortProxy';
import { getServerUrl } from '@/sync/serverConfig';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';

type LocalHost = '127.0.0.1' | 'localhost' | '::1';

const HOST_OPTIONS: LocalHost[] = ['127.0.0.1', 'localhost', '::1'];

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    inputWrapper: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
    },
    input: {
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 17,
        color: theme.colors.text,
        ...Typography.default(),
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        marginHorizontal: 16,
        marginTop: 24,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        height: 50,
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 17,
        ...Typography.default('semiBold'),
    },
    validationText: {
        marginHorizontal: 24,
        marginTop: 8,
        color: theme.colors.textDestructive,
        fontSize: 13,
        ...Typography.default(),
    },
}));

function machineTitle(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

interface MachineItemProps {
    machine: Machine;
    isSelected: boolean;
    onSelect: () => void;
    showDivider?: boolean;
}

const MachineItem = React.memo(({ machine, isSelected, onSelect, showDivider = true }: MachineItemProps) => {
    const { theme } = useUnistyles();
    return (
        <Item
            title={machineTitle(machine)}
            subtitle={`${machine.metadata?.platform || ''}${machine.active ? ` · ${t('status.online')}` : ` · ${t('status.offline')}`}`.replace(/^ · /, '')}
            subtitleLines={1}
            rightElement={isSelected ? (
                <Ionicons name="checkmark-circle" size={24} color={theme.colors.status.connected} />
            ) : (
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: theme.colors.divider }} />
            )}
            onPress={onSelect}
            showChevron={false}
            showDivider={showDivider}
        />
    );
});

interface PortProxyFormProps {
    mode: 'create' | 'edit';
    initialProxy?: PortProxyRecord;
}

export function PortProxyForm({ mode, initialProxy }: PortProxyFormProps) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    const auth = useAuth();
    const machines = useAllMachines();
    const [name, setName] = React.useState(initialProxy?.name ?? '');
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(initialProxy?.machineId ?? null);
    const [localHost, setLocalHost] = React.useState<LocalHost>(initialProxy?.localHost ?? '127.0.0.1');
    const [localPort, setLocalPort] = React.useState(initialProxy ? String(initialProxy.localPort) : '3000');
    const [enabled, setEnabled] = React.useState(initialProxy?.enabled ?? true);
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (!selectedMachineId && machines.length > 0) {
            setSelectedMachineId(machines[0].id);
        }
    }, [machines, selectedMachineId]);

    const parsedPort = Number(localPort.trim());
    const relayUrl = React.useMemo(() => initialProxy ? buildPortProxyUrl(getServerUrl(), initialProxy) : null, [initialProxy]);
    const isValidPort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
    const canSubmit = !!auth.credentials
        && !!selectedMachineId
        && name.trim().length > 0
        && isValidPort;

    const handleCopyRelayUrl = React.useCallback(async () => {
        if (!relayUrl) return;
        await Clipboard.setStringAsync(relayUrl);
        showCopiedToast();
    }, [relayUrl]);

    const handleSubmit = React.useCallback(async () => {
        if (!canSubmit || !auth.credentials || !selectedMachineId || isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (mode === 'create') {
                await createPortProxy(auth.credentials, {
                    machineId: selectedMachineId,
                    name: name.trim(),
                    localHost,
                    localPort: parsedPort,
                    protocol: 'http',
                    enabled,
                });
            } else if (initialProxy) {
                await updatePortProxy(auth.credentials, initialProxy.id, {
                    name: name.trim(),
                    localHost,
                    localPort: parsedPort,
                    enabled,
                });
            }
            router.back();
        } catch (error) {
            showToast(error instanceof Error ? error.message : t('portProxy.saveFailed'));
        } finally {
            setIsSubmitting(false);
        }
    }, [auth.credentials, canSubmit, enabled, initialProxy, isSubmitting, localHost, mode, name, parsedPort, router, selectedMachineId]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? Constants.statusBarHeight + headerHeight : 0}
        >
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: safeArea.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
                <ItemGroup title={t('portProxy.name')}>
                    <View style={styles.inputWrapper}>
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder={t('portProxy.namePlaceholder')}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="words"
                            autoCorrect={false}
                        />
                    </View>
                </ItemGroup>

                <ItemGroup title={t('portProxy.selectMachine')} footer={mode === 'edit' ? t('portProxy.machineLockedHint') : undefined}>
                    {machines.length === 0 ? (
                        <Item
                            title={t('portProxy.noMachines')}
                            subtitle={t('portProxy.noMachinesDescription')}
                            disabled
                            showChevron={false}
                        />
                    ) : (
                        machines
                            .filter((machine) => mode === 'create' || machine.id === selectedMachineId)
                            .map((machine, index, visibleMachines) => (
                                <MachineItem
                                    key={machine.id}
                                    machine={machine}
                                    isSelected={selectedMachineId === machine.id}
                                    onSelect={() => { if (mode === 'create') setSelectedMachineId(machine.id); }}
                                    showDivider={index < visibleMachines.length - 1}
                                />
                            ))
                    )}
                </ItemGroup>

                <ItemGroup title={t('portProxy.localHost')}>
                    {HOST_OPTIONS.map((host, index) => (
                        <Item
                            key={host}
                            title={host}
                            rightElement={localHost === host ? (
                                <Ionicons name="checkmark-circle" size={24} color={theme.colors.status.connected} />
                            ) : null}
                            onPress={() => setLocalHost(host)}
                            showChevron={false}
                            showDivider={index < HOST_OPTIONS.length - 1}
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t('portProxy.localPort')} footer={t('portProxy.localPortHint')}>
                    <View style={styles.inputWrapper}>
                        <TextInput
                            style={styles.input}
                            value={localPort}
                            onChangeText={setLocalPort}
                            placeholder="3000"
                            placeholderTextColor={theme.colors.textSecondary}
                            keyboardType="number-pad"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </ItemGroup>
                {localPort.trim().length > 0 && !isValidPort ? (
                    <Text style={styles.validationText}>{t('portProxy.invalidPort')}</Text>
                ) : null}

                {relayUrl ? (
                    <ItemGroup title={t('portProxy.relayUrl')}>
                        <Item
                            title={relayUrl}
                            subtitle={t('portProxy.copyRelayUrl')}
                            subtitleLines={1}
                            onPress={handleCopyRelayUrl}
                            showChevron={false}
                        />
                    </ItemGroup>
                ) : null}

                <ItemGroup title={t('portProxy.options')}>
                    <Item
                        title={t('portProxy.enabled')}
                        subtitle={t('portProxy.enabledDescription')}
                        rightElement={enabled ? (
                            <Ionicons name="checkmark-circle" size={24} color={theme.colors.status.connected} />
                        ) : (
                            <Ionicons name="ellipse-outline" size={24} color={theme.colors.textSecondary} />
                        )}
                        onPress={() => setEnabled(!enabled)}
                        showChevron={false}
                    />
                </ItemGroup>

                <Pressable
                    style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={!canSubmit || isSubmitting}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color={theme.colors.button.primary.tint} />
                    ) : (
                        <Text style={styles.submitButtonText}>{mode === 'create' ? t('portProxy.create') : t('common.save')}</Text>
                    )}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
