import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { VAULT_MIN_CLI_VERSION, type VaultKey } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { showCopiedToast } from '@/components/Toast';
import { VaultChip, VaultKeyIcon, vaultMachineName } from '@/components/VaultSections';
import { Typography } from '@/constants/Typography';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAllMachines, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { deleteVaultKey, saveVaultKey, useVault } from '@/sync/vault';
import { VAULT_FIELD_LABELS, VAULT_RULE_OPTIONS, vaultDenyLabel, vaultSay } from '@/sync/vaultRules';
import { formatLastSeen, getSessionName } from '@/utils/sessionUtils';
import { isVersionSupported } from '@/utils/versionUtils';

type Editing = 'allow' | 'deny' | 'scope' | null;

/**
 * Everything about one key on one screen: how to use it, what it may run (tap to toggle),
 * what must not be touched and its recent use. Rarely needed settings sit under "Advanced".
 * Every change is saved right away.
 */
export const VaultKeyDetail = React.memo(({ keyId, onShowUsage, onDeleted }: { keyId: string; onShowUsage?: () => void; onDeleted?: () => void }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const vault = useVault();
    const machines = useAllMachines();
    const key = vault.keys.find((candidate) => candidate.id === keyId);
    const [menu, setMenu] = React.useState(false);
    const [advanced, setAdvanced] = React.useState(false);
    const [editing, setEditing] = React.useState<Editing>(null);
    const [draft, setDraft] = React.useState('');
    const [draft2, setDraft2] = React.useState('');
    React.useEffect(() => { setAdvanced(false); setEditing(null); }, [keyId]);

    const eligible = React.useMemo(() => machines.filter((machine) => !!sync.encryption.getMachineEncryption(machine.id)), [machines]);

    const update = React.useCallback(async (patch: Partial<VaultKey>) => {
        if (!key) return;
        try {
            await saveVaultKey({ ...key, ...patch }, key);
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [key]);

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

    if (!key) return null;

    const options = VAULT_RULE_OPTIONS[key.kind];
    const custom = key.allow.filter((rule) => !options.some((option) => option.pattern === rule));
    const allDevices = !key.ssh && eligible.length > 0 && eligible.every((machine) => key.machineIds.includes(machine.id));
    const outdated = eligible.filter((machine) => !isVersionSupported(machine.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION));
    const logs = vault.logs.filter((entry) => entry.keyId === key.id);
    const lastUse = logs.find((entry) => entry.outcome !== 'denied');
    const say = vaultSay(key);
    const devicesText = key.ssh
        ? t('resources.connectsFrom', { name: vaultMachineName(key.ssh.viaMachineId) })
        : allDevices ? t('resources.allDevicesUse') : t('resources.someDevicesUse', { names: key.machineIds.map(vaultMachineName).join('、') || '—' });

    const rename = async () => {
        const next = await Modal.prompt(t('resources.rename'), undefined, { defaultValue: key.name, confirmText: t('common.save'), cancelText: t('common.cancel') });
        if (next?.trim()) await update({ name: next.trim() });
    };
    const changeSlug = async () => {
        const next = (await Modal.prompt(t('resources.slug'), t('resources.slugHint'), { defaultValue: key.slug, confirmText: t('common.save'), cancelText: t('common.cancel') }))?.trim();
        if (!next || next === key.slug) return;
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(next)) return Modal.alert(t('common.error'), t('resources.slugInvalid'));
        if (vault.keys.some((other) => other.slug === next)) return Modal.alert(t('common.error'), t('resources.slugTaken'));
        await update({ slug: next });
    };
    const remove = async () => {
        const confirmed = await Modal.confirm(t('resources.deleteKey'), t('resources.deleteConfirm', { name: key.name }), {
            confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true,
        });
        if (!confirmed) return;
        try {
            await deleteVaultKey(key);
            onDeleted?.();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    };
    const startEditing = (what: Editing) => { setEditing(editing === what ? null : what); setDraft(''); setDraft2(''); };
    const commit = async () => {
        const value = draft.trim();
        if (!value) return;
        if (editing === 'allow' && !key.allow.includes(value)) await update({ allow: [...key.allow, value] });
        if (editing === 'deny' && !key.deny.includes(value)) await update({ deny: [...key.deny, value] });
        if (editing === 'scope') await update({ scope: [...key.scope, { name: value, protected: draft2.trim() }] });
        setEditing(null);
    };
    const inline = (placeholder: string, second?: string) => (
        <View style={styles.inline}>
            <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.input.placeholder}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => { void commit(); }}
                style={[styles.input, editing !== 'scope' && styles.mono]}
            />
            {second !== undefined && (
                <TextInput value={draft2} onChangeText={setDraft2} placeholder={second} placeholderTextColor={theme.colors.input.placeholder} onSubmitEditing={() => { void commit(); }} style={styles.input} />
            )}
            <Pressable onPress={() => { void commit(); }} style={styles.smallButton}><Text style={styles.smallButtonText}>{t('resources.add')}</Text></Pressable>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <VaultKeyIcon kind={key.kind} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{key.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                        {devicesText} · {lastUse ? t('resources.lastUsed', { when: formatLastSeen(lastUse.at) }) : t('resources.neverUsed')}
                    </Text>
                </View>
                <Pressable onPress={rotate} disabled={rotating} style={styles.headerButton}><Text style={styles.headerButtonText}>{t('resources.rotate')}</Text></Pressable>
                <Pressable onPress={() => setMenu(true)} style={styles.headerButton} accessibilityLabel={t('resources.more')}><Text style={styles.headerButtonText}>⋯</Text></Pressable>
            </View>

            <View style={styles.say}>
                <Text style={styles.sayText}>{t('resources.sayIntro')}<Text style={styles.saySentence}>{say}</Text></Text>
                <Pressable onPress={() => { void Clipboard.setStringAsync(say).then(showCopiedToast); }} hitSlop={8}>
                    <Text style={styles.link}>{t('common.copy')}</Text>
                </Pressable>
            </View>

            <Text style={styles.section}>{t('resources.canDo')}<Text style={styles.sectionHint}>{`  ${t('resources.tapToToggle')}`}</Text></Text>
            <View style={styles.tags}>
                {options.map((option) => {
                    const on = key.allow.includes(option.pattern);
                    return (
                        <Pressable
                            key={option.pattern}
                            onPress={() => { void update({ allow: on ? key.allow.filter((rule) => rule !== option.pattern) : [...key.allow, option.pattern] }); }}
                            style={[styles.tag, on && styles.tagOn, option.risk && !on && styles.tagRisk]}
                        >
                            <Text style={[styles.tagText, on && styles.tagTextOn]}>{on ? '✓ ' : ''}{option.label()}</Text>
                            {option.risk && <Text style={styles.risk}>{t('resources.risky')}</Text>}
                        </Pressable>
                    );
                })}
                {custom.map((rule) => (
                    <Pressable key={rule} onPress={() => { void update({ allow: key.allow.filter((other) => other !== rule) }); }} style={[styles.tag, styles.tagOn]} accessibilityHint={t('resources.tapToRemove')}>
                        <Text style={[styles.tagText, styles.tagTextOn, styles.mono]}>✓ {rule}</Text>
                    </Pressable>
                ))}
                <Pressable onPress={() => startEditing('allow')} style={[styles.tag, styles.tagAdd]}>
                    <Text style={styles.link}>＋ {t('resources.writeOwn')}</Text>
                </Pressable>
            </View>
            {editing === 'allow' && inline(t('resources.allowPlaceholder'))}

            <View style={styles.sectionRow}>
                <Text style={styles.section}>{t('resources.doNotTouchTitle')}<Text style={styles.sectionHint}>{`  ${t('resources.scopeHint')}`}</Text></Text>
                <Pressable onPress={() => startEditing('scope')} hitSlop={8}><Text style={styles.link}>＋ {t('resources.add')}</Text></Pressable>
            </View>
            {key.scope.length === 0 && editing !== 'scope' && <Text style={styles.none}>{t('resources.notWritten')}</Text>}
            {key.scope.map((scope, index) => (
                <View key={`${scope.name}-${index}`} style={styles.protect}>
                    <Text style={styles.protectName}>{scope.name}</Text>
                    <Text style={styles.protectText}>{scope.protected || '—'}</Text>
                    <Pressable onPress={() => { void update({ scope: key.scope.filter((_, i) => i !== index) }); }} hitSlop={8}><Text style={styles.protectX}>✕</Text></Pressable>
                </View>
            ))}
            {editing === 'scope' && inline(t('resources.scopeName'), t('resources.scopeProtected'))}

            <View style={styles.sectionRow}>
                <Text style={styles.section}>{t('resources.recentUse')}</Text>
                {onShowUsage && logs.length > 0 && <Pressable onPress={onShowUsage} hitSlop={8}><Text style={styles.link}>{t('resources.allUsage')}</Text></Pressable>}
            </View>
            {logs.length === 0 && <Text style={styles.none}>{t('resources.notUsedYet')}</Text>}
            {logs.slice(0, onShowUsage ? 4 : 20).map((entry) => {
                const session = entry.sessionId ? storage.getState().sessions[entry.sessionId] : null;
                return (
                    <View key={`${entry.at}-${entry.command}`} style={styles.logRow}>
                        <Text style={styles.logWhen}>{formatLastSeen(entry.at)}</Text>
                        <Text style={[styles.logCommand, styles.mono]} numberOfLines={1}>{entry.command}</Text>
                        <Text style={styles.logSession} numberOfLines={1}>{session ? getSessionName(session) : ''}</Text>
                        <Text style={[styles.logOutcome, { color: entry.outcome === 'ok' ? '#16A34A' : entry.outcome === 'denied' ? '#B45309' : theme.colors.textDestructive }]}>
                            {entry.outcome === 'ok' ? t('resources.outcomeOk') : entry.outcome === 'denied' ? t('resources.outcomeDenied') : t('resources.outcomeFailed')}
                        </Text>
                    </View>
                );
            })}

            <Pressable onPress={() => setAdvanced(!advanced)} style={styles.advancedToggle}>
                <Text style={styles.link}>{advanced ? '▾' : '▸'} {t('resources.advanced')}</Text>
            </Pressable>
            {advanced && (
                <View>
                    <View style={styles.kv}>
                        <Text style={styles.kvKey}>{t('resources.slug')}</Text>
                        <Text style={[styles.kvValue, styles.mono]}>{key.slug}</Text>
                        <Pressable onPress={() => { void changeSlug(); }} hitSlop={8}><Text style={styles.link}>{t('resources.change')}</Text></Pressable>
                    </View>
                    <View style={styles.kv}>
                        <Text style={styles.kvKey}>{key.ssh ? t('resources.via') : t('resources.devices')}</Text>
                        <View style={[styles.kvValue, { gap: 6 }]}>
                            {key.ssh ? (
                                <View style={styles.tags}>
                                    {eligible.filter((m) => isVersionSupported(m.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION)).map((machine) => (
                                        <VaultChip key={machine.id} label={vaultMachineName(machine.id)} selected={key.ssh!.viaMachineId === machine.id} onPress={() => { void update({ ssh: { ...key.ssh!, viaMachineId: machine.id } }); }} />
                                    ))}
                                </View>
                            ) : (
                                <>
                                    <View style={styles.tags}>
                                        <VaultChip label={t('resources.devicesAll')} selected={allDevices} onPress={() => { void update({ machineIds: eligible.map((m) => m.id) }); }} />
                                        {eligible.map((machine) => (
                                            <VaultChip
                                                key={machine.id}
                                                label={vaultMachineName(machine.id)}
                                                selected={!allDevices && key.machineIds.includes(machine.id)}
                                                onPress={() => {
                                                    const current = allDevices ? [] : key.machineIds;
                                                    const next = current.includes(machine.id) ? current.filter((id) => id !== machine.id) : [...current, machine.id];
                                                    if (next.length > 0) void update({ machineIds: next });
                                                }}
                                            />
                                        ))}
                                    </View>
                                    {outdated.length > 0 && <Text style={styles.hint}>{t('resources.cliOldInline', { names: outdated.map((m) => vaultMachineName(m.id)).join('、'), version: VAULT_MIN_CLI_VERSION })}</Text>}
                                    <Text style={styles.hint}>{t('resources.mcpNote')}</Text>
                                </>
                            )}
                        </View>
                    </View>
                    <View style={styles.kv}>
                        <Text style={styles.kvKey}>{t('resources.deny')}</Text>
                        <View style={[styles.kvValue, { gap: 6 }]}>
                            <View style={styles.tags}>
                                {key.deny.map((rule) => (
                                    <Pressable key={rule} onPress={() => { void update({ deny: key.deny.filter((other) => other !== rule) }); }} style={[styles.tag, styles.tagDeny]}>
                                        <Text style={styles.tagDenyText}>{vaultDenyLabel(rule)} ✕</Text>
                                    </Pressable>
                                ))}
                                <Pressable onPress={() => startEditing('deny')} style={[styles.tag, styles.tagAdd]}><Text style={styles.link}>＋ {t('resources.add')}</Text></Pressable>
                            </View>
                            {editing === 'deny' && inline(t('resources.denyPlaceholder'))}
                            <Text style={styles.hint}>{t('resources.guardNote')}</Text>
                        </View>
                    </View>
                    {key.ssh ? (
                        <View style={styles.kv}>
                            <Text style={styles.kvKey}>{t('resources.login')}</Text>
                            <Text style={[styles.kvValue, styles.mono]}>{`${key.ssh.user}@${key.ssh.host}:${key.ssh.port}`}</Text>
                        </View>
                    ) : key.env.map((v) => (
                        <View key={v.name} style={styles.kv}>
                            <Text style={styles.kvKey} numberOfLines={1}>{VAULT_FIELD_LABELS[v.name]?.label ?? v.name}</Text>
                            <Text style={[styles.kvValue, !v.secret && styles.mono]} numberOfLines={1}>{v.secret ? t('resources.secretSaved') : v.value}</Text>
                        </View>
                    ))}
                </View>
            )}

            <ActionMenuModal
                visible={menu}
                onClose={() => setMenu(false)}
                title={key.name}
                items={[
                    { label: t('resources.rename'), onPress: () => { setMenu(false); void rename(); } },
                    { label: t('resources.deleteKey'), destructive: true, onPress: () => { setMenu(false); void remove(); } },
                ]}
            />
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 28,
        gap: 4,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    sub: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    headerButton: {
        paddingHorizontal: 11,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    headerButtonText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    say: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 14,
        padding: 11,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.dark ? 'rgba(34,197,94,0.35)' : '#BBF7D0',
        backgroundColor: theme.dark ? 'rgba(34,197,94,0.12)' : '#F0FDF4',
    },
    sayText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 13.5,
        lineHeight: 19,
        color: theme.dark ? '#BBF7D0' : '#14532D',
    },
    saySentence: {
        ...Typography.default('semiBold'),
    },
    section: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 18,
        marginBottom: 6,
    },
    sectionHint: {
        ...Typography.default(),
        fontSize: 12,
    },
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    tags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    tagOn: {
        borderColor: theme.dark ? 'rgba(34,197,94,0.5)' : '#86EFAC',
        backgroundColor: theme.dark ? 'rgba(34,197,94,0.14)' : '#ECFDF3',
    },
    tagRisk: { borderStyle: 'dashed' },
    tagAdd: { borderStyle: 'dashed' },
    tagText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    tagTextOn: { color: theme.dark ? '#86EFAC' : '#166534' },
    tagDeny: {
        borderColor: theme.dark ? 'rgba(239,68,68,0.4)' : '#FECACA',
        backgroundColor: theme.dark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
    },
    tagDenyText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textDestructive,
    },
    risk: {
        ...Typography.default(),
        fontSize: 11,
        color: '#B45309',
    },
    protect: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 11,
        paddingVertical: 8,
        borderRadius: 9,
        marginBottom: 6,
        backgroundColor: theme.dark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
    },
    protectName: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textDestructive,
    },
    protectText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 13,
        color: theme.dark ? '#FCA5A5' : '#7F1D1D',
    },
    protectX: {
        fontSize: 13,
        color: theme.colors.textDestructive,
        opacity: 0.6,
    },
    none: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    inline: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 6,
    },
    input: {
        ...Typography.default(),
        flexGrow: 1,
        flexBasis: 180,
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        fontSize: 13.5,
        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
    },
    mono: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 12.5,
    },
    smallButton: {
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    smallButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.button.primary.tint,
    },
    logRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 7,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    logWhen: {
        ...Typography.default(),
        width: 70,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    logCommand: {
        flex: 1,
        color: theme.colors.text,
    },
    logSession: {
        ...Typography.default(),
        maxWidth: 120,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    logOutcome: {
        ...Typography.default(),
        fontSize: 12,
    },
    advancedToggle: {
        marginTop: 20,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    kv: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    kvKey: {
        ...Typography.default(),
        width: 110,
        fontSize: 13,
        color: theme.colors.textSecondary,
        paddingTop: 2,
    },
    kvValue: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        color: theme.colors.text,
    },
    hint: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.textSecondary,
    },
    link: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textLink,
    },
}));
