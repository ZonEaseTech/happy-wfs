import * as React from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { VAULT_KIND_PRESETS, VAULT_MIN_CLI_VERSION, VaultKeyKindSchema, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { useDesktopRoute, useRouteParams } from '@/components/desktopRoutes';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { VaultChip, vaultKindLabel } from '@/components/VaultSections';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { t } from '@/text';
import { listDeviceShares } from '@/sync/apiDevices';
import { storage } from '@/sync/storage';
import { saveVaultKey, useVault } from '@/sync/vault';
import { isVersionSupported } from '@/utils/versionUtils';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function blankKey(kind: VaultKeyKind): VaultKey {
    const preset = VAULT_KIND_PRESETS[kind];
    return {
        v: 1, id: newId(), slug: '', kind, name: '',
        env: preset.env.map((v) => ({ name: v.name, value: '', secret: v.secret })),
        ssh: kind === 'ssh' ? { host: '', port: 22, user: 'root', auth: 'password', secret: '', viaMachineId: '' } : null,
        allow: [...preset.allow], deny: [...preset.deny], scope: [], machineIds: [], updatedAt: 0,
    };
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    const styles = stylesheet;
    return (
        <View style={styles.field}>
            <Text style={styles.label}>
                {label}
                {!!hint && <Text style={styles.labelHint}>{`  ${hint}`}</Text>}
            </Text>
            {children}
        </View>
    );
}

/** Resource center › add or edit a key (`?id=` to edit), as one form. */
export default React.memo(function VaultKeyEditScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const auth = useAuth();
    const { isInDrawer, dismiss } = useDesktopRoute();
    const { id } = useRouteParams<{ id?: string }>();
    const vault = useVault();
    const existing = id ? vault.keys.find((key) => key.id === id) ?? null : null;
    const [draft, setDraft] = React.useState<VaultKey>(() => existing ?? blankKey('cloudflare'));
    const update = (patch: Partial<VaultKey>) => setDraft((current) => ({ ...current, ...patch }));
    // Opened before the keys finished loading: take the stored key once it arrives.
    React.useEffect(() => {
        if (existing && draft.id !== existing.id) setDraft(existing);
    }, [existing, draft.id]);
    const machines = storage((state) => state.machines);
    const machineList = React.useMemo(() => Object.values(machines).sort((a, b) => Number(b.active) - Number(a.active)), [machines]);
    const [sharedIds, setSharedIds] = React.useState<string[]>([]);
    React.useEffect(() => {
        if (!auth.credentials) return;
        listDeviceShares(auth.credentials).then((shares) => setSharedIds(shares.flatMap((share) => share.machineIds))).catch(() => { });
    }, [auth.credentials]);
    const nameOf = (machineId: string) => machines[machineId]?.metadata?.displayName || machines[machineId]?.metadata?.host || machineId.slice(0, 8);
    const cliTooOld = (machineId: string) => !isVersionSupported(machines[machineId]?.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION);

    // Text typed into an "add" box but not added yet is still saved with the key.
    const [newAllow, setNewAllow] = React.useState('');
    const [newDeny, setNewDeny] = React.useState('');
    const [newVariable, setNewVariable] = React.useState('');
    const [scopeName, setScopeName] = React.useState('');
    const [scopeProtected, setScopeProtected] = React.useState('');

    const addRule = (list: 'allow' | 'deny') => {
        const rule = (list === 'allow' ? newAllow : newDeny).trim();
        if (rule && !draft[list].includes(rule)) update({ [list]: [...draft[list], rule] });
        (list === 'allow' ? setNewAllow : setNewDeny)('');
    };
    const addScope = () => {
        if (!scopeName.trim()) return;
        update({ scope: [...draft.scope, { name: scopeName.trim(), protected: scopeProtected.trim() }] });
        setScopeName('');
        setScopeProtected('');
    };
    const addVariable = () => {
        const name = newVariable.trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !draft.env.some((v) => v.name === name)) {
            update({ env: [...draft.env, { name, value: '', secret: true }] });
        }
        setNewVariable('');
    };
    const toggleDevice = (machineId: string) => update({
        machineIds: draft.machineIds.includes(machineId)
            ? draft.machineIds.filter((m) => m !== machineId)
            : [...draft.machineIds, machineId],
    });

    const [saving, save] = useHappyAction(async () => {
        const slug = draft.slug || slugOf(draft.name);
        const pending = (list: string[], value: string) => (value.trim() && !list.includes(value.trim()) ? [...list, value.trim()] : list);
        const next: VaultKey = {
            ...draft,
            slug,
            name: draft.name.trim(),
            allow: pending(draft.allow, newAllow),
            deny: pending(draft.deny, newDeny),
            scope: scopeName.trim() ? [...draft.scope, { name: scopeName.trim(), protected: scopeProtected.trim() }] : draft.scope,
        };
        if (!next.name) throw new Error(t('resources.nameRequired'));
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) throw new Error(t('resources.slugInvalid'));
        if (vault.keys.some((key) => key.slug === slug && key.id !== next.id)) throw new Error(t('resources.slugTaken'));
        if (next.env.some((v) => !v.name || (v.secret && !v.value))) throw new Error(t('resources.secretRequired'));
        if (next.ssh && (!next.ssh.host || !next.ssh.user || !next.ssh.secret || !next.ssh.port)) throw new Error(t('resources.loginRequired'));
        if (next.ssh && !next.ssh.viaMachineId) throw new Error(t('resources.viaRequired'));
        await saveVaultKey(next, existing);
        dismiss();
    });

    const ssh = draft.ssh;
    const updateSsh = (patch: Partial<NonNullable<VaultKey['ssh']>>) => update({ ssh: { ...ssh!, ...patch } });
    const input = (props: React.ComponentProps<typeof TextInput> & { mono?: boolean }) => (
        <TextInput
            placeholderTextColor={theme.colors.input.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            {...props}
            style={[styles.input, props.mono && styles.mono, props.style]}
        />
    );
    const addButton = (onPress: () => void) => (
        <Pressable onPress={onPress} style={styles.smallButton} accessibilityRole="button">
            <Text style={styles.smallButtonText}>{t('resources.add')}</Text>
        </Pressable>
    );
    const selectedShared = draft.machineIds.filter((m) => sharedIds.includes(m));
    const selectedOld = (ssh ? [ssh.viaMachineId].filter(Boolean) : draft.machineIds).filter(cliTooOld);
    const secretLabel = ssh?.auth === 'key' ? t('resources.authKey') : t('resources.authPassword');

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: existing ? t('resources.editKey') : t('resources.newKey'), headerBackTitle: t('common.back') }} />}
            <View style={styles.card}>
                {!existing && (
                    <Field label={t('resources.kind')}>
                        <View style={styles.chips}>
                            {VaultKeyKindSchema.options.map((kind) => (
                                <VaultChip
                                    key={kind}
                                    label={vaultKindLabel(kind)}
                                    selected={draft.kind === kind}
                                    onPress={() => setDraft({ ...blankKey(kind), id: draft.id, name: draft.name, slug: draft.slug, machineIds: draft.machineIds })}
                                />
                            ))}
                        </View>
                    </Field>
                )}

                <Field label={t('resources.name')}>
                    {input({ value: draft.name, onChangeText: (name) => update({ name }), placeholder: ssh ? t('resources.namePlaceholderSsh') : t('resources.namePlaceholder'), autoCapitalize: 'sentences' })}
                </Field>
                <Field label={t('resources.slug')} hint={t('resources.slugUsage', { slug: draft.slug || slugOf(draft.name) || t('resources.slugFallback') })}>
                    {input({ value: draft.slug, onChangeText: (slug) => update({ slug: slug.toLowerCase() }), placeholder: slugOf(draft.name) || 'cf-personal', mono: true })}
                </Field>

                {ssh ? (
                    <>
                        <Field label={t('resources.hostPortUser')}>
                            <View style={styles.row}>
                                {input({ value: ssh.host, onChangeText: (host) => updateSsh({ host: host.trim() }), placeholder: t('resources.hostPlaceholder'), style: { flex: 1 } })}
                                {input({ value: ssh.port ? String(ssh.port) : '', onChangeText: (value) => updateSsh({ port: Math.min(65535, Number(value.replace(/\D/g, '')) || 0) }), placeholder: '22', keyboardType: 'number-pad', style: { width: 64 } })}
                                {input({ value: ssh.user, onChangeText: (user) => updateSsh({ user: user.trim() }), placeholder: 'root', style: { width: 96 } })}
                            </View>
                        </Field>
                        {!existing && (
                            <Field label={t('resources.authMethod')}>
                                <View style={styles.chips}>
                                    {(['password', 'key'] as const).map((method) => (
                                        <VaultChip
                                            key={method}
                                            label={method === 'password' ? t('resources.authPassword') : t('resources.authKey')}
                                            selected={ssh.auth === method}
                                            onPress={() => updateSsh({ auth: method, secret: '' })}
                                        />
                                    ))}
                                </View>
                            </Field>
                        )}
                        <Field label={secretLabel} hint={existing ? undefined : t('resources.secretNeverShown')}>
                            {existing ? (
                                <Text style={styles.locked}>{t('resources.secretLocked')}</Text>
                            ) : input({
                                value: ssh.secret,
                                onChangeText: (secret) => updateSsh({ secret }),
                                secureTextEntry: ssh.auth === 'password',
                                multiline: ssh.auth === 'key',
                                placeholder: ssh.auth === 'key' ? '-----BEGIN OPENSSH PRIVATE KEY-----' : undefined,
                                mono: ssh.auth === 'key',
                                style: ssh.auth === 'key' ? { height: 96, paddingTop: 8, textAlignVertical: 'top' } : undefined,
                            })}
                        </Field>
                        <Field label={t('resources.via')} hint={t('resources.viaFooter')}>
                            <View style={styles.chips}>
                                {machineList.filter((m) => !sharedIds.includes(m.id)).map((m) => (
                                    <VaultChip key={m.id} label={nameOf(m.id)} selected={ssh.viaMachineId === m.id} onPress={() => updateSsh({ viaMachineId: m.id })} />
                                ))}
                            </View>
                        </Field>
                    </>
                ) : (
                    <Field label={t('resources.secrets')} hint={existing ? undefined : t('resources.secretsNeverShown')}>
                        {draft.env.map((v, index) => (
                            <View key={`${v.name}-${index}`} style={[styles.row, styles.envRow]}>
                                <Text style={[styles.mono, styles.envName]} numberOfLines={1}>{v.name}</Text>
                                {existing && v.secret ? (
                                    <Text style={[styles.locked, { flex: 1 }]}>{t('resources.secretLocked')}</Text>
                                ) : input({
                                    value: v.value,
                                    onChangeText: (value) => update({ env: draft.env.map((item, i) => (i === index ? { ...item, value } : item)) }),
                                    secureTextEntry: v.secret,
                                    placeholder: v.secret ? t('resources.secretPlaceholder') : t('resources.plainPlaceholder'),
                                    style: { flex: 1, minWidth: 180 },
                                })}
                                {draft.kind === 'custom' && !existing && (
                                    <Pressable onPress={() => update({ env: draft.env.filter((_, i) => i !== index) })} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('resources.remove')}>
                                        <Text style={styles.removeX}>✕</Text>
                                    </Pressable>
                                )}
                            </View>
                        ))}
                        {draft.kind === 'custom' && !existing && (
                            <View style={styles.row}>
                                {input({ value: newVariable, onChangeText: setNewVariable, placeholder: t('resources.variableName'), mono: true, style: { flex: 1 }, onSubmitEditing: addVariable })}
                                {addButton(addVariable)}
                            </View>
                        )}
                    </Field>
                )}

                <Field label={t('resources.allow')} hint={t('resources.allowHint')}>
                    <View style={styles.chips}>
                        {draft.allow.length === 0 && <Text style={styles.empty}>{t('resources.emptyRules')}</Text>}
                        {draft.allow.map((rule) => (
                            <VaultChip key={rule} label={rule} tone="code" onRemove={() => update({ allow: draft.allow.filter((r) => r !== rule) })} />
                        ))}
                    </View>
                    <View style={[styles.row, { marginTop: 6 }]}>
                        {input({ value: newAllow, onChangeText: setNewAllow, placeholder: t('resources.allowPlaceholder'), mono: true, style: { flex: 1 }, onSubmitEditing: () => addRule('allow') })}
                        {addButton(() => addRule('allow'))}
                    </View>
                </Field>
                <Field label={t('resources.deny')} hint={t('resources.denyHint')}>
                    <View style={styles.chips}>
                        {draft.deny.length === 0 && <Text style={styles.empty}>{t('resources.emptyRules')}</Text>}
                        {draft.deny.map((rule) => (
                            <VaultChip key={rule} label={rule} tone="deny" onRemove={() => update({ deny: draft.deny.filter((r) => r !== rule) })} />
                        ))}
                    </View>
                    <View style={[styles.row, { marginTop: 6 }]}>
                        {input({ value: newDeny, onChangeText: setNewDeny, placeholder: t('resources.denyPlaceholder'), mono: true, style: { flex: 1 }, onSubmitEditing: () => addRule('deny') })}
                        {addButton(() => addRule('deny'))}
                    </View>
                </Field>

                <Field label={t('resources.scopeLabel')} hint={t('resources.scopeHint')}>
                    {draft.scope.length > 0 && (
                        <View style={[styles.chips, { marginBottom: 6 }]}>
                            {draft.scope.map((scope, index) => (
                                <VaultChip
                                    key={`${scope.name}-${index}`}
                                    label={scope.protected ? `${scope.name} · ${t('resources.doNotTouch', { what: scope.protected })}` : scope.name}
                                    onRemove={() => update({ scope: draft.scope.filter((_, i) => i !== index) })}
                                />
                            ))}
                        </View>
                    )}
                    <View style={[styles.row, { flexWrap: 'wrap' }]}>
                        {input({ value: scopeName, onChangeText: setScopeName, placeholder: ssh ? t('resources.scopePlaceholderSsh') : t('resources.scopeName'), style: styles.scopeInput })}
                        {input({ value: scopeProtected, onChangeText: setScopeProtected, placeholder: t('resources.scopeProtected'), style: styles.scopeInput, onSubmitEditing: addScope })}
                        {addButton(addScope)}
                    </View>
                </Field>

                {!ssh && (
                    <Field label={t('resources.devices')} hint={t('resources.devicesFooter')}>
                        <View style={styles.chips}>
                            {machineList.map((m) => (
                                <VaultChip
                                    key={m.id}
                                    label={sharedIds.includes(m.id) ? `${nameOf(m.id)} · ${t('resources.mcpSharedShort')}` : nameOf(m.id)}
                                    tone={sharedIds.includes(m.id) ? 'warn' : 'default'}
                                    selected={draft.machineIds.includes(m.id)}
                                    checked={draft.machineIds.includes(m.id)}
                                    onPress={() => toggleDevice(m.id)}
                                />
                            ))}
                        </View>
                        {selectedShared.length > 0 && (
                            <Text style={styles.warn}>{t('resources.mcpWarnInline', { names: selectedShared.map(nameOf).join('、') })}</Text>
                        )}
                    </Field>
                )}
                {selectedOld.length > 0 && (
                    <Text style={styles.warn}>{t('resources.cliOldInline', { names: selectedOld.map(nameOf).join('、'), version: VAULT_MIN_CLI_VERSION })}</Text>
                )}
            </View>

            <View style={styles.footer}>
                <Pressable onPress={dismiss} style={styles.button} accessibilityRole="button">
                    <Text style={styles.buttonText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={save} disabled={saving} style={[styles.button, styles.primary, saving && { opacity: 0.6 }]} accessibilityRole="button">
                    <Text style={[styles.buttonText, styles.primaryText]}>{t('resources.save')}</Text>
                </Pressable>
            </View>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: Platform.select({ ios: 16, default: 12 }),
        marginTop: 16,
        borderRadius: Platform.select({ ios: 10, default: 16 }),
        paddingHorizontal: 16,
        paddingBottom: 16,
        maxWidth: layout.maxWidth,
    },
    field: {
        paddingTop: 14,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
        marginBottom: 6,
    },
    labelHint: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
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
        fontSize: 15,
        minWidth: 0,
        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
    },
    mono: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13.5,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    // Side by side on wide screens; on phones the second box and the button drop to their own line.
    scopeInput: {
        flexGrow: 1,
        flexBasis: 200,
    },
    envRow: {
        flexWrap: 'wrap',
        marginBottom: 6,
    },
    envName: {
        width: 210,
        fontSize: 13,
        color: theme.colors.text,
    },
    locked: {
        ...Typography.default(),
        fontSize: 13.5,
        color: theme.colors.textSecondary,
        paddingVertical: 8,
    },
    empty: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    removeX: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        paddingHorizontal: 4,
    },
    smallButton: {
        height: 38,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
    },
    smallButtonText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    warn: {
        ...Typography.default(),
        marginTop: 8,
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.box.warning.text,
        backgroundColor: theme.colors.box.warning.background,
        borderRadius: 8,
        padding: 8,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
        paddingTop: 16,
        maxWidth: layout.maxWidth,
    },
    button: {
        height: 40,
        paddingHorizontal: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
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
