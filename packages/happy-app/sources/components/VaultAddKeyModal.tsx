import * as React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { VAULT_KIND_PRESETS, VAULT_MIN_CLI_VERSION, VaultKeyKindSchema, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { VaultChip, VaultKeyIcon, vaultKindLabel } from '@/components/VaultSections';
import { Typography } from '@/constants/Typography';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAllMachines } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { saveVaultKey, useVault } from '@/sync/vault';
import { VAULT_FIELD_LABELS as FIELD_LABELS, detectVaultPaste, parseSshAddress, vaultAutoSlug, vaultCanDo, type VaultPasteGuess } from '@/sync/vaultRules';
import { isVersionSupported } from '@/utils/versionUtils';
import type { Machine } from '@/sync/storageTypes';

const machineName = (machine: Machine) => machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 8);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const guessText = (guess: VaultPasteGuess): string => (
    guess.kind === 'github' ? t('resources.guessGithub')
        : guess.kind === 'npm' ? t('resources.guessNpm')
            : guess.kind === 'aliyun' ? t('resources.guessAliyun')
                : guess.as === 'privateKey' ? t('resources.guessPrivateKey') : t('resources.guessAddress')
);

/** Only the head and tail of a pasted secret stay readable. */
const maskValue = (value: string) => (value.length > 12 ? `${value.slice(0, 4)}••••••••••••${value.slice(-4)}` : '••••••••');

/**
 * Resource center › add a key by pasting it. Values with a fixed shape (GitHub, npm, Alibaba
 * Cloud, private keys, user@host) pick their type; anything else asks for it. Rules start from
 * the type's preset and every usable device gets a copy unless the user narrows it.
 */
export const VaultAddKeyModal = React.memo(({ onClose, kind: initialKind, onSaved }: {
    onClose: () => void;
    kind?: VaultKeyKind;
    onSaved?: (key: VaultKey) => void;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const vault = useVault();
    const machines = useAllMachines();
    // A copy can only go to a device whose key this client holds.
    const eligible = React.useMemo(() => machines.filter((machine) => !!sync.encryption.getMachineEncryption(machine.id)), [machines]);
    const cliReady = (machine: Machine) => isVersionSupported(machine.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION);
    const outdated = eligible.filter((machine) => !cliReady(machine));

    const uniqueName = (base: string) => {
        let name = base;
        for (let i = 2; vault.keys.some((key) => key.name === name); i++) name = `${base} ${i}`;
        return name;
    };

    const [raw, setRaw] = React.useState('');
    const [guess, setGuess] = React.useState<VaultPasteGuess | null>(null);
    const [kind, setKind] = React.useState<VaultKeyKind | null>(initialKind ?? null);
    const [values, setValues] = React.useState<Record<string, string>>({});
    const [varName, setVarName] = React.useState('MY_SECRET');
    const [name, setName] = React.useState(initialKind ? uniqueName(vaultKindLabel(initialKind)) : '');
    const [address, setAddress] = React.useState('');
    const [auth, setAuth] = React.useState<'password' | 'key'>('password');
    const [secret, setSecret] = React.useState('');
    const [via, setVia] = React.useState(eligible.find(cliReady)?.id ?? '');
    const [allDevices, setAllDevices] = React.useState(true);
    const [deviceIds, setDeviceIds] = React.useState<string[]>([]);
    const [showDevices, setShowDevices] = React.useState(false);

    /** Puts the pasted value where it belongs for `next` and names the key after it. */
    const fill = (next: VaultKeyKind, text: string, pasted: VaultPasteGuess | null) => {
        const value = text.trim();
        setKind(next);
        if (next === 'ssh') {
            if (pasted?.as === 'address') setAddress(value);
            else if (pasted?.as === 'privateKey') { setAuth('key'); setSecret(text); } else if (value) { setAuth('password'); setSecret(value); }
            setName(uniqueName(pasted?.as === 'address' ? parseSshAddress(value)?.host ?? vaultKindLabel(next) : vaultKindLabel(next)));
            return;
        }
        const env = VAULT_KIND_PRESETS[next].env;
        const target = next === 'aliyun' && pasted?.as !== 'id' ? env[1].name : next === 'custom' ? 'value' : env[0].name;
        setValues(value ? { [target]: value } : {});
        setName(uniqueName(vaultKindLabel(next)));
    };
    const onPaste = (text: string) => {
        setRaw(text);
        const detected = detectVaultPaste(text);
        setGuess(detected);
        if (detected) fill(detected.kind, text, detected);
    };
    const pickKind = (next: VaultKeyKind) => fill(next, raw, guess?.kind === next ? guess : null);
    const startOver = () => { setRaw(''); setGuess(null); setKind(null); setValues({}); setAddress(''); setSecret(''); };

    const [saving, save] = useHappyAction(async () => {
        if (!kind) return;
        const preset = VAULT_KIND_PRESETS[kind];
        if (!name.trim()) throw new Error(t('resources.nameRequired'));
        let ssh: VaultKey['ssh'] = null;
        let env: VaultKey['env'] = [];
        if (kind === 'ssh') {
            const login = parseSshAddress(address);
            if (!login) throw new Error(t('resources.addressInvalid'));
            if (!secret.trim()) throw new Error(t('resources.loginRequired'));
            if (!via) throw new Error(t('resources.viaRequired'));
            ssh = { ...login, auth, secret: auth === 'key' ? secret : secret.trim(), viaMachineId: via };
        } else if (kind === 'custom') {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) throw new Error(t('resources.variableInvalid'));
            if (!values.value?.trim()) throw new Error(t('resources.secretRequired'));
            env = [{ name: varName, value: values.value.trim(), secret: true }];
        } else {
            // Optional plain values that were left empty are not injected at all.
            env = preset.env.map((v) => ({ name: v.name, value: (values[v.name] ?? '').trim(), secret: v.secret })).filter((v) => v.value || !FIELD_LABELS[v.name]?.optional);
            if (env.some((v) => !v.value)) throw new Error(t('resources.secretRequired'));
        }
        const machineIds = kind === 'ssh' ? [] : allDevices ? eligible.map((machine) => machine.id) : deviceIds;
        if (kind !== 'ssh' && machineIds.length === 0) throw new Error(t('resources.devicesRequired'));
        const key: VaultKey = {
            v: 1, id: newId(), kind, name: name.trim(),
            slug: vaultAutoSlug(name, kind, vault.keys.map((existing) => existing.slug)),
            env, ssh, allow: [...preset.allow], deny: [...preset.deny], scope: [], machineIds, updatedAt: 0,
        };
        await saveVaultKey(key, null);
        onClose();
        onSaved?.(key);
    });

    const input = (props: React.ComponentProps<typeof TextInput> & { mono?: boolean }) => (
        <TextInput
            placeholderTextColor={theme.colors.input.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            {...props}
            style={[styles.input, props.mono && styles.mono, props.style]}
        />
    );
    const label = (text: string, hint?: string) => (
        <Text style={styles.label}>{text}{!!hint && <Text style={styles.labelHint}>{`  ${hint}`}</Text>}</Text>
    );
    const kindChips = (
        <View style={styles.chips}>
            {VaultKeyKindSchema.options.map((option) => <VaultChip key={option} label={vaultKindLabel(option)} onPress={() => pickKind(option)} />)}
        </View>
    );

    let body: React.ReactNode;
    if (!kind) {
        // Short input stays visible so it can be typed; anything longer is treated as pasted and masked.
        body = raw.trim().length < 8 ? (
            <>
                {input({ value: raw, onChangeText: onPaste, placeholder: t('resources.pastePlaceholder'), multiline: true, autoFocus: true, mono: true, style: styles.paste })}
                <Text style={styles.hint}>{t('resources.pasteHint')}</Text>
                {label(t('resources.orPickKind'))}
                {kindChips}
            </>
        ) : (
            <>
                <View style={styles.pasted}>
                    <Text style={[styles.mono, { flex: 1 }]} numberOfLines={1}>{maskValue(raw.trim())}</Text>
                    <Pressable onPress={startOver} hitSlop={8}><Text style={styles.link}>{t('resources.pasteAgain')}</Text></Pressable>
                </View>
                <View style={styles.ask}>
                    <Text style={styles.askText}>{t('resources.pickKindPrompt')}</Text>
                    {kindChips}
                </View>
            </>
        );
    } else {
        const preset = VAULT_KIND_PRESETS[kind];
        const recognised = guess?.kind === kind;
        body = (
            <>
                <View style={styles.kindRow}>
                    <VaultKeyIcon kind={kind} size={28} />
                    <Text style={styles.kindName}>{vaultKindLabel(kind)}</Text>
                    {recognised && <Text style={styles.recognised} numberOfLines={1}>{`✓ ${t('resources.recognised', { what: guessText(guess!) })}`}</Text>}
                    <View style={{ flex: 1 }} />
                    {!initialKind && <Pressable onPress={() => setKind(null)} hitSlop={8}><Text style={styles.link}>{t('resources.changeKind')}</Text></Pressable>}
                </View>

                {kind === 'ssh' ? (
                    <>
                        {label(t('resources.address'), t('resources.addressHint'))}
                        {input({ value: address, onChangeText: setAddress, placeholder: 'dev@43.239.84.25', mono: true })}
                        <View style={styles.labelRow}>
                            {label(auth === 'password' ? t('resources.authPassword') : t('resources.authKey'), t('resources.secretNeverShown'))}
                            <Pressable onPress={() => { setAuth(auth === 'password' ? 'key' : 'password'); setSecret(''); }} hitSlop={8}>
                                <Text style={styles.link}>{auth === 'password' ? t('resources.useKeyInstead') : t('resources.usePasswordInstead')}</Text>
                            </Pressable>
                        </View>
                        {auth === 'password'
                            ? input({ value: secret, onChangeText: setSecret, secureTextEntry: true })
                            : input({ value: secret, onChangeText: setSecret, multiline: true, mono: true, placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', style: { height: 90, paddingTop: 8, textAlignVertical: 'top' } })}
                        {label(t('resources.via'), t('resources.viaHint'))}
                        <View style={styles.chips}>
                            {eligible.filter(cliReady).map((machine) => <VaultChip key={machine.id} label={machineName(machine)} selected={via === machine.id} onPress={() => setVia(machine.id)} />)}
                        </View>
                    </>
                ) : kind === 'custom' ? (
                    <>
                        {label(t('resources.variableLabel'))}
                        {input({ value: varName, onChangeText: setVarName, mono: true })}
                        {label(t('resources.value'), t('resources.secretNeverShown'))}
                        {input({ value: values.value ?? '', onChangeText: (value) => setValues({ value }), secureTextEntry: true, autoFocus: !values.value })}
                    </>
                ) : preset.env.map((v) => {
                    const field = FIELD_LABELS[v.name] ?? { label: v.name };
                    return (
                        <React.Fragment key={v.name}>
                            {label(field.optional ? `${field.label} · ${t('resources.optional')}` : field.label, field.where?.())}
                            {input({
                                value: values[v.name] ?? '',
                                onChangeText: (value) => setValues((current) => ({ ...current, [v.name]: value })),
                                secureTextEntry: v.secret,
                                placeholder: v.secret ? t('resources.secretPlaceholder') : field.optional ? t('resources.optionalPlaceholder') : '',
                                autoFocus: !values[v.name] && preset.env.findIndex((other) => !values[other.name]) === preset.env.indexOf(v),
                                mono: !v.secret,
                            })}
                        </React.Fragment>
                    );
                })}

                {label(t('resources.name'))}
                {input({ value: name, onChangeText: setName, autoCapitalize: 'sentences' })}

                {kind !== 'ssh' && (
                    <>
                        <View style={styles.line}>
                            <Text style={styles.lineText}>
                                {allDevices ? t('resources.allDevicesCount', { count: eligible.length }) : t('resources.onlyDevices', { names: deviceIds.map((id) => machineName(eligible.find((m) => m.id === id)!)).join('、') || '—' })}
                            </Text>
                            <Pressable onPress={() => setShowDevices(!showDevices)} hitSlop={8}><Text style={styles.link}>{showDevices ? t('resources.collapse') : t('resources.change')}</Text></Pressable>
                        </View>
                        {showDevices && (
                            <View style={{ gap: 8, marginTop: 4 }}>
                                <View style={styles.chips}>
                                    <VaultChip label={t('resources.devicesAll')} selected={allDevices} onPress={() => setAllDevices(true)} />
                                    <VaultChip label={t('resources.devicesSome')} selected={!allDevices} onPress={() => { setAllDevices(false); if (deviceIds.length === 0) setDeviceIds(eligible.map((m) => m.id)); }} />
                                </View>
                                {!allDevices && (
                                    <View style={styles.chips}>
                                        {eligible.map((machine) => (
                                            <VaultChip
                                                key={machine.id}
                                                label={machineName(machine)}
                                                selected={deviceIds.includes(machine.id)}
                                                onPress={() => setDeviceIds((current) => (current.includes(machine.id) ? current.filter((id) => id !== machine.id) : [...current, machine.id]))}
                                            />
                                        ))}
                                    </View>
                                )}
                                {outdated.length > 0 && <Text style={styles.hint}>{t('resources.cliOldInline', { names: outdated.map(machineName).join('、'), version: VAULT_MIN_CLI_VERSION })}</Text>}
                                <Text style={styles.hint}>{t('resources.mcpNote')}</Text>
                            </View>
                        )}
                    </>
                )}

                <View style={[styles.line, kind !== 'ssh' && styles.lineTight]}>
                    <Text style={styles.lineText}>
                        {t('resources.canDoPreview', { what: vaultCanDo({ kind, allow: preset.allow, deny: preset.deny }) })}
                        {'\n'}
                        <Text style={styles.hint}>{t('resources.canDoLater')}</Text>
                    </Text>
                </View>
            </>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{kind ? t('resources.addKind', { kind: vaultKindLabel(kind) }) : t('resources.addKey')}</Text>
                <Pressable onPress={onClose} hitSlop={10}><Text style={styles.close}>✕</Text></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {body}
            </ScrollView>
            <View style={styles.footer}>
                <Pressable onPress={onClose} style={styles.button}><Text style={styles.buttonText}>{t('common.cancel')}</Text></Pressable>
                <Pressable onPress={save} disabled={!kind || saving} style={[styles.button, styles.primary, (!kind || saving) && { opacity: 0.4 }]}>
                    <Text style={[styles.buttonText, styles.primaryText]}>{t('resources.save')}</Text>
                </Pressable>
            </View>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
        width: 480,
        maxWidth: '100%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
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
        gap: 6,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
        marginTop: 8,
    },
    labelHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
    },
    input: {
        ...Typography.default(),
        height: 38,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        fontSize: 14.5,
        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
    },
    mono: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13.5,
    },
    paste: {
        height: 96,
        paddingTop: 12,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: '#93C5FD',
        borderRadius: 12,
        textAlignVertical: 'top',
    },
    pasted: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 2,
        borderColor: '#BFDBFE',
        borderRadius: 12,
        padding: 12,
    },
    ask: {
        marginTop: 8,
        gap: 8,
        padding: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.box.warning.background,
    },
    askText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    hint: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.textSecondary,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    kindRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingBottom: 4,
    },
    kindName: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    recognised: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 12.5,
        color: '#16A34A',
    },
    link: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textLink,
    },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    lineTight: {
        marginTop: 8,
        paddingTop: 0,
        borderTopWidth: 0,
    },
    lineText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.text,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        padding: 14,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    button: {
        height: 36,
        paddingHorizontal: 18,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    primary: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    primaryText: {
        color: theme.colors.button.primary.tint,
    },
}));

/** Opens the paste-to-add dialog; `onSaved` gets the new key. */
export function openVaultAddKey(kind?: VaultKeyKind, onSaved?: (key: VaultKey) => void) {
    Modal.show({ component: VaultAddKeyModal, props: { kind, onSaved } });
}
