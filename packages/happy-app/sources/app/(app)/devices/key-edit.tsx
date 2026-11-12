import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { VAULT_KIND_PRESETS, VAULT_MIN_CLI_VERSION, VaultKeyKindSchema, type VaultKey, type VaultKeyKind } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { useDesktopRoute, useRouteParams } from '@/components/desktopRoutes';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { vaultKindLabel } from '@/components/VaultSections';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
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

/** Resource center › add or edit a key (`?id=` to edit). Every field is set through a prompt, like the other settings pages. */
export default React.memo(function VaultKeyEditScreen() {
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

    const prompt = async (title: string, value: string, opts: { secure?: boolean; multiline?: boolean; hint?: string } = {}) => {
        const next = await Modal.prompt(title, opts.hint, {
            defaultValue: opts.secure ? '' : value,
            inputType: opts.secure && !opts.multiline ? 'secure-text' : undefined,
            multiline: opts.multiline,
            confirmText: t('common.save'),
            cancelText: t('common.cancel'),
        });
        return next === null ? null : next.trim();
    };

    const editRules = (list: 'allow' | 'deny') => async () => {
        const rule = await prompt(list === 'allow' ? t('resources.allow') : t('resources.deny'), '', { hint: t('resources.rulePrompt') });
        if (rule && !draft[list].includes(rule)) update({ [list]: [...draft[list], rule] });
    };

    const toggleDevice = async (machineId: string) => {
        if (draft.machineIds.includes(machineId)) {
            update({ machineIds: draft.machineIds.filter((m) => m !== machineId) });
            return;
        }
        const ok = !sharedIds.includes(machineId) || await Modal.confirm(t('resources.mcpSharedTitle'), t('resources.mcpSharedWarning'), {
            confirmText: t('common.ok'), cancelText: t('common.cancel'),
        });
        if (ok) update({ machineIds: [...draft.machineIds, machineId] });
    };

    const [saving, save] = useHappyAction(async () => {
        const slug = draft.slug || slugOf(draft.name);
        if (!draft.name.trim()) throw new Error(t('resources.nameRequired'));
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) throw new Error(t('resources.slugInvalid'));
        if (vault.keys.some((key) => key.slug === slug && key.id !== draft.id)) throw new Error(t('resources.slugTaken'));
        if (draft.env.some((v) => !v.name || (v.secret && !v.value))) throw new Error(t('resources.secretRequired'));
        if (draft.ssh && (!draft.ssh.host || !draft.ssh.user || !draft.ssh.secret)) throw new Error(t('resources.loginRequired'));
        if (draft.ssh && !draft.ssh.viaMachineId) throw new Error(t('resources.viaRequired'));
        await saveVaultKey({ ...draft, slug, name: draft.name.trim() }, existing);
        dismiss();
    });

    const removeButton = (onPress: () => void) => (
        <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
            <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>{t('resources.remove')}</Text>
        </Pressable>
    );
    const ssh = draft.ssh;
    const updateSsh = (patch: Partial<NonNullable<VaultKey['ssh']>>) => update({ ssh: { ...ssh!, ...patch } });

    return (
        <ItemList>
            {!isInDrawer && <Stack.Screen options={{ headerTitle: existing ? t('resources.editKey') : t('resources.newKey'), headerBackTitle: t('common.back') }} />}

            {!existing && (
                <ItemGroup title={t('resources.kind')}>
                    {VaultKeyKindSchema.options.map((kind) => (
                        <Item
                            key={kind}
                            title={vaultKindLabel(kind)}
                            selected={draft.kind === kind}
                            onPress={() => setDraft({ ...blankKey(kind), id: draft.id, name: draft.name, slug: draft.slug, machineIds: draft.machineIds })}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            <ItemGroup>
                <Item title={t('resources.name')} detail={draft.name || '—'} onPress={async () => { const v = await prompt(t('resources.name'), draft.name); if (v !== null) update({ name: v }); }} />
                <Item
                    title={t('resources.slug')}
                    detail={draft.slug || slugOf(draft.name) || '—'}
                    detailStyle={{ fontFamily: 'IBMPlexMono-Regular' }}
                    onPress={async () => { const v = await prompt(t('resources.slug'), draft.slug || slugOf(draft.name), { hint: t('resources.slugHint') }); if (v !== null) update({ slug: v }); }}
                />
            </ItemGroup>

            {ssh ? (
                <>
                    <ItemGroup title={t('resources.login')}>
                        <Item title={t('resources.host')} detail={ssh.host || '—'} onPress={async () => { const v = await prompt(t('resources.host'), ssh.host); if (v !== null) updateSsh({ host: v }); }} />
                        <Item title={t('resources.port')} detail={String(ssh.port)} onPress={async () => { const v = await prompt(t('resources.port'), String(ssh.port)); const port = Number(v); if (v !== null && Number.isInteger(port) && port > 0 && port < 65536) updateSsh({ port }); }} />
                        <Item title={t('resources.user')} detail={ssh.user || '—'} onPress={async () => { const v = await prompt(t('resources.user'), ssh.user); if (v !== null) updateSsh({ user: v }); }} />
                        {!existing && (['password', 'key'] as const).map((method) => (
                            <Item key={method} title={method === 'password' ? t('resources.authPassword') : t('resources.authKey')} selected={ssh.auth === method} onPress={() => updateSsh({ auth: method, secret: '' })} showChevron={false} />
                        ))}
                        {!existing && (
                            <Item
                                title={ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey')}
                                detail={ssh.secret ? t('resources.secretSaved') : t('resources.secretMissing')}
                                onPress={async () => { const v = await prompt(ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey'), '', { secure: true, multiline: ssh.auth === 'key', hint: t('resources.secretPrompt') }); if (v) updateSsh({ secret: v }); }}
                            />
                        )}
                    </ItemGroup>
                    <ItemGroup title={t('resources.via')} footer={t('resources.viaFooter')}>
                        {machineList.filter((m) => !sharedIds.includes(m.id)).map((m) => (
                            <Item
                                key={m.id}
                                title={nameOf(m.id)}
                                subtitle={isVersionSupported(m.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION) ? undefined : t('resources.cliTooOld', { version: VAULT_MIN_CLI_VERSION })}
                                selected={ssh.viaMachineId === m.id}
                                onPress={() => updateSsh({ viaMachineId: m.id })}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>
                </>
            ) : (
                <ItemGroup title={t('resources.secrets')}>
                    {draft.env.map((v, index) => (
                        <Item
                            key={`${v.name}-${index}`}
                            title={v.name}
                            titleStyle={{ fontFamily: 'IBMPlexMono-Regular', fontSize: 13 }}
                            detail={v.secret ? (v.value ? t('resources.secretSaved') : t('resources.secretMissing')) : (v.value || t('resources.secretMissing'))}
                            onPress={existing && v.secret ? undefined : async () => {
                                const value = await prompt(v.name, v.value, { secure: v.secret, hint: t('resources.secretPrompt') });
                                if (value !== null) update({ env: draft.env.map((item, i) => (i === index ? { ...item, value } : item)) });
                            }}
                            rightElement={draft.kind === 'custom' && !existing ? removeButton(() => update({ env: draft.env.filter((_, i) => i !== index) })) : undefined}
                            showChevron={false}
                        />
                    ))}
                    {draft.kind === 'custom' && !existing && (
                        <Item
                            title={t('resources.addVariable')}
                            icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                            onPress={async () => {
                                const name = await prompt(t('resources.addVariable'), '', { hint: t('resources.variableName') });
                                if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) update({ env: [...draft.env, { name, value: '', secret: true }] });
                            }}
                            showChevron={false}
                        />
                    )}
                </ItemGroup>
            )}

            <ItemGroup title={t('resources.allow')} footer={t('resources.allowFooter')}>
                {draft.allow.map((rule) => (
                    <Item key={rule} title={rule} titleStyle={{ fontFamily: 'IBMPlexMono-Regular', fontSize: 13 }} rightElement={removeButton(() => update({ allow: draft.allow.filter((r) => r !== rule) }))} showChevron={false} />
                ))}
                <Item title={t('resources.addRule')} icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />} onPress={editRules('allow')} showChevron={false} />
            </ItemGroup>
            <ItemGroup title={t('resources.deny')} footer={t('resources.denyFooter')}>
                {draft.deny.map((rule) => (
                    <Item key={rule} title={rule} titleStyle={{ fontFamily: 'IBMPlexMono-Regular', fontSize: 13, color: theme.colors.textDestructive }} rightElement={removeButton(() => update({ deny: draft.deny.filter((r) => r !== rule) }))} showChevron={false} />
                ))}
                <Item title={t('resources.addRule')} icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />} onPress={editRules('deny')} showChevron={false} />
            </ItemGroup>

            <ItemGroup title={t('resources.scope')} footer={t('resources.scopeFooter')}>
                {draft.scope.map((scope, index) => (
                    <Item
                        key={`${scope.name}-${index}`}
                        title={scope.name}
                        subtitle={scope.protected ? t('resources.doNotTouch', { what: scope.protected }) : undefined}
                        rightElement={removeButton(() => update({ scope: draft.scope.filter((_, i) => i !== index) }))}
                        showChevron={false}
                    />
                ))}
                <Item
                    title={t('resources.addScope')}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    onPress={async () => {
                        const name = await prompt(t('resources.scope'), '', { hint: t('resources.scopeName') });
                        if (!name) return;
                        const protectedPart = await prompt(t('resources.scope'), '', { hint: t('resources.scopeProtected') });
                        update({ scope: [...draft.scope, { name, protected: protectedPart ?? '' }] });
                    }}
                    showChevron={false}
                />
            </ItemGroup>

            {!ssh && (
                <ItemGroup title={t('resources.devices')} footer={t('resources.devicesFooter')}>
                    {machineList.map((m) => (
                        <Item
                            key={m.id}
                            title={nameOf(m.id)}
                            subtitle={[
                                sharedIds.includes(m.id) ? t('resources.mcpSharedTitle') : null,
                                isVersionSupported(m.metadata?.happyCliVersion, VAULT_MIN_CLI_VERSION) ? null : t('resources.cliTooOld', { version: VAULT_MIN_CLI_VERSION }),
                            ].filter(Boolean).join(' · ') || undefined}
                            selected={draft.machineIds.includes(m.id)}
                            onPress={() => { void toggleDevice(m.id); }}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            <ItemGroup>
                <Item title={t('resources.save')} titleStyle={{ color: theme.colors.textLink, fontWeight: '600' }} loading={saving} onPress={save} showChevron={false} />
            </ItemGroup>
            <View style={{ height: 24 }} />
        </ItemList>
    );
});
