import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useShallow } from 'zustand/react/shallow';
import { VaultKeySchema, vaultKeyDevices, type VaultKey } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { VaultKeyIcon, vaultKindLabel, vaultMachineName } from '@/components/VaultSections';
import { Typography } from '@/constants/Typography';
import { useHappyAction } from '@/hooks/useHappyAction';
import { t } from '@/text';
import { loadVaultProposalsDone, saveVaultProposalsDone, type VaultProposalDone } from '@/sync/persistence';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { deleteVaultKey, saveVaultKey, useVault } from '@/sync/vault';
import { buildVaultProposal, vaultKeyUnchanged, type VaultProposalProblem, type VaultProposalTool } from '@/sync/vaultProposal';
import { VAULT_FIELD_LABELS, VAULT_RULE_OPTIONS, vaultDenyLabel } from '@/sync/vaultRules';
import type { ToolCall } from '@/sync/typesMessage';

type Line = { text: string; mono?: boolean; tone?: 'add' | 'remove' };
/** One label/value line of the card; `fill` turns the value into an input for something the agent left out. */
type Row = { label: string; mono?: boolean; lines: Line[]; fill?: { name: string; secret: boolean; multiline?: boolean } };

/** What the user did on each card, kept across reloads so a handled draft is never offered again. */
const handled = new Map(Object.entries(loadVaultProposalsDone()));

const doneText = ({ done, name }: VaultProposalDone): string => (
    done === 'added' ? t('resources.keyAddedDone', { name })
        : done === 'changed' ? t('resources.proposalChangedDone', { name }) : t('resources.proposalDeletedDone', { name })
);

const problemText = (problem: VaultProposalProblem): string => {
    switch (problem.kind) {
        case 'name': return t('resources.nameRequired');
        case 'slugInvalid': return t('resources.slugInvalid');
        case 'slugTaken': return t('resources.slugTaken');
        case 'login': return t('resources.loginRequired');
        case 'devices': return t('resources.devicesRequired');
        case 'device': return t('resources.proposalUnknownDevice', { name: problem.name });
        case 'input': return t('resources.proposalInvalid');
    }
};

const ruleLine = (key: VaultKey, rule: string, tone?: Line['tone']): Line => {
    const option = VAULT_RULE_OPTIONS[key.kind].find((candidate) => candidate.pattern === rule);
    return option ? { text: option.label(), tone } : { text: rule, mono: true, tone };
};

const devicesText = (key: VaultKey, online: string[]): string => {
    const devices = vaultKeyDevices(key);
    return online.length > 0 && online.every((id) => devices.includes(id)) && devices.length === online.length
        ? t('resources.allDevicesCount', { count: devices.length })
        : t('resources.onlyDevices', { names: devices.map(vaultMachineName).join('、') });
};

/** Everything a new key will have, with inputs for the values the agent did not have. */
function addRows(key: VaultKey, missing: string[], online: string[]): Row[] {
    const rows: Row[] = [{ label: t('resources.slug'), lines: [{ text: key.slug, mono: true }] }];
    if (key.ssh) {
        rows.push({ label: t('resources.login'), lines: [{ text: `${key.ssh.user}@${key.ssh.host}:${key.ssh.port}`, mono: true }] });
        rows.push({
            label: key.ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey'),
            lines: [{ text: t('resources.proposalFilled') }],
            fill: missing.includes('ssh') ? { name: 'ssh', secret: key.ssh.auth === 'password', multiline: key.ssh.auth === 'key' } : undefined,
        });
    }
    for (const v of key.env) {
        rows.push({
            label: VAULT_FIELD_LABELS[v.name]?.label ?? v.name,
            mono: !VAULT_FIELD_LABELS[v.name],
            lines: [v.secret ? { text: t('resources.proposalFilled') } : { text: v.value, mono: true }],
            fill: missing.includes(v.name) ? { name: v.name, secret: v.secret } : undefined,
        });
    }
    rows.push({ label: t('resources.canDo'), lines: key.allow.length ? key.allow.map((rule) => ruleLine(key, rule)) : [{ text: t('resources.canDoNothing') }] });
    if (key.deny.length) rows.push({ label: t('resources.deny'), lines: key.deny.map((rule) => ({ text: vaultDenyLabel(rule), mono: vaultDenyLabel(rule) === rule })) });
    rows.push({ label: t('resources.devices'), lines: [{ text: devicesText(key, online) }] });
    return rows;
}

/** Only what changes: + for added, − for removed, → for replaced. */
function editRows(key: VaultKey, previous: VaultKey, missing: string[]): Row[] {
    const rows: Row[] = [];
    if (key.name !== previous.name) rows.push({ label: t('resources.name'), lines: [{ text: `${previous.name} → ${key.name}` }] });
    if (key.slug !== previous.slug) rows.push({ label: t('resources.slug'), lines: [{ text: `${previous.slug} → ${key.slug}`, mono: true }] });
    if (key.ssh && previous.ssh) {
        const login = (ssh: NonNullable<VaultKey['ssh']>) => `${ssh.user}@${ssh.host}:${ssh.port}`;
        if (login(key.ssh) !== login(previous.ssh)) rows.push({ label: t('resources.login'), lines: [{ text: `${login(previous.ssh)} → ${login(key.ssh)}`, mono: true }] });
        if (key.ssh.secret !== previous.ssh.secret || key.ssh.auth !== previous.ssh.auth) {
            rows.push({
                label: key.ssh.auth === 'password' ? t('resources.authPassword') : t('resources.authKey'),
                lines: [{ text: t('resources.proposalNewValue'), tone: 'add' }],
                fill: missing.includes('ssh') ? { name: 'ssh', secret: key.ssh.auth === 'password', multiline: key.ssh.auth === 'key' } : undefined,
            });
        }
    }
    for (const v of key.env) {
        const before = previous.env.find((other) => other.name === v.name);
        if (before && before.value === v.value && before.secret === v.secret) continue;
        const text = v.secret ? (before ? t('resources.proposalNewValue') : t('resources.proposalFilled')) : before && !before.secret ? `${before.value} → ${v.value}` : v.value;
        rows.push({ label: v.name, mono: true, lines: [{ text: `${before ? '' : '+ '}${text}`, mono: !v.secret, tone: 'add' }], fill: missing.includes(v.name) ? { name: v.name, secret: v.secret } : undefined });
    }
    for (const v of previous.env.filter((before) => !key.env.some((after) => after.name === before.name))) {
        rows.push({ label: v.name, mono: true, lines: [{ text: `− ${t('resources.proposalRemoved')}`, tone: 'remove' }] });
    }
    const listDiff = (label: string, next: string[], before: string[], line: (rule: string, tone: Line['tone']) => Line) => {
        const lines = [
            ...next.filter((rule) => !before.includes(rule)).map((rule) => line(rule, 'add')),
            ...before.filter((rule) => !next.includes(rule)).map((rule) => line(rule, 'remove')),
        ];
        if (lines.length) rows.push({ label, lines: lines.map((item) => ({ ...item, text: `${item.tone === 'add' ? '+' : '−'} ${item.text}` })) });
    };
    listDiff(t('resources.canDo'), key.allow, previous.allow, (rule, tone) => ruleLine(key, rule, tone));
    listDiff(t('resources.deny'), key.deny, previous.deny, (rule, tone) => ({ text: vaultDenyLabel(rule), mono: vaultDenyLabel(rule) === rule, tone }));
    listDiff(t('resources.devices'), vaultKeyDevices(key), vaultKeyDevices(previous), (id, tone) => ({ text: vaultMachineName(id), tone }));
    return rows;
}

/**
 * Under an agent's `save_key` / `delete_key` call: what it wants to add, change or delete in the
 * resource center, for the user to confirm with one tap. The agent's call itself changes nothing,
 * so this is the only place its draft can turn into a key; afterwards the agent is told by a
 * message, like the allow and add buttons under shell commands (VaultToolFooter).
 */
export const VaultProposalCard = React.memo(({ sessionId, tool, toolKind }: { sessionId: string; tool: ToolCall; toolKind: VaultProposalTool }) => {
    const styles = stylesheet;
    // Message ids are handed out afresh on every load; the call's time and a hash of its input
    // (never the input itself, it may hold a secret) name the card across reloads and devices.
    const cardId = React.useMemo(() => {
        const text = `${tool.name}:${JSON.stringify(tool.input)}`;
        let hash = 5381;
        for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        return `${sessionId}:${tool.createdAt}:${(hash >>> 0).toString(36)}`;
    }, [sessionId, tool.name, tool.input, tool.createdAt]);
    const { theme } = useUnistyles();
    const vault = useVault();
    const machines = storage(useShallow((state) => state.machines));
    const devices = React.useMemo(() => Object.values(machines)
        .filter((machine) => !!sync.encryption.getMachineEncryption(machine.id))
        .map((machine) => ({ id: machine.id, name: vaultMachineName(machine.id), online: machine.active })), [machines]);
    const proposal = React.useMemo(() => buildVaultProposal(toolKind, tool.input, vault.keys, devices), [toolKind, tool.input, vault.keys, devices]);
    const [fills, setFills] = React.useState<Record<string, string>>({});
    const [done, setDone] = React.useState<VaultProposalDone | null>(() => handled.get(cardId) ?? null);
    const finish = (result: VaultProposalDone) => {
        handled.set(cardId, result);
        saveVaultProposalsDone(Object.fromEntries([...handled].slice(-200)));
        setDone(result);
    };

    const [busy, confirm] = useHappyAction(async () => {
        if (proposal.action === 'delete') {
            await deleteVaultKey(proposal.previous);
            finish({ done: 'deleted', name: proposal.previous.name });
            await sync.sendMessage(sessionId, t('resources.keyDeletedMessage', { name: proposal.previous.name }));
            return;
        }
        if (proposal.action !== 'add' && proposal.action !== 'edit') return;
        const fill = (name: string) => fills[name]?.trim() ?? '';
        const ssh = proposal.key.ssh;
        const key: VaultKey = {
            ...proposal.key,
            id: proposal.key.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
            env: proposal.key.env.map((v) => (v.value ? v : { ...v, value: fill(v.name) })),
            // A private key keeps its line breaks; a password is trimmed.
            ssh: ssh && (ssh.secret ? ssh : { ...ssh, secret: ssh.auth === 'key' ? fills.ssh ?? '' : fill('ssh') }),
        };
        if (key.env.some((v) => !v.value) || (key.ssh && !key.ssh.secret.trim())) throw new Error(t('resources.secretRequired'));
        const parsed = VaultKeySchema.safeParse(key);
        if (!parsed.success) throw new Error(t('resources.proposalInvalid'));
        await saveVaultKey(parsed.data, proposal.action === 'edit' ? proposal.previous : null);
        if (proposal.action === 'add') {
            finish({ done: 'added', name: key.name });
            await sync.sendMessage(sessionId, t('resources.keyAddedMessage', { name: key.name, slug: key.slug }));
        } else {
            finish({ done: 'changed', name: key.name });
            await sync.sendMessage(sessionId, t('resources.keyChangedMessage', { name: key.name }));
        }
    });

    if (!vault.loaded) return null;
    const doneBar = (text: string) => <View style={[styles.bar, styles.barDone]}><Text style={styles.done}>{`✓ ${text}`}</Text></View>;
    if (done) return doneBar(doneText(done));

    // Saved from another screen or device since the agent asked: say so instead of offering it again.
    const draftName = typeof tool.input?.name === 'string' ? tool.input.name.trim() : '';
    const added = toolKind === 'save_key' && !tool.input?.key && draftName ? vault.keys.find((key) => key.name === draftName && key.updatedAt >= tool.createdAt) : undefined;
    if (added) return doneBar(t('resources.keyAddedDone', { name: added.name }));
    if (proposal.action === 'edit' && vaultKeyUnchanged(proposal.key, proposal.previous)) {
        return doneBar(proposal.previous.updatedAt >= tool.createdAt ? t('resources.proposalChangedDone', { name: proposal.previous.name }) : t('resources.proposalUnchanged', { name: proposal.previous.name }));
    }

    if (proposal.action === 'gone' || proposal.action === 'invalid') {
        const reason = proposal.action === 'gone' ? t('resources.proposalGone', { name: proposal.name }) : problemText(proposal.problem);
        return (
            <View style={styles.bar}>
                <Text style={styles.text}>{proposal.action === 'gone' ? reason : t('resources.proposalCantSave', { reason })}</Text>
                {/* A key to delete that is already gone needs nothing more from the agent. */}
                {toolKind === 'save_key' && (
                    <View style={styles.buttons}>
                        <Pressable onPress={() => { sync.sendMessage(sessionId, t('resources.proposalFixMessage', { reason })).catch(() => { }); }} style={styles.button}>
                            <Text style={styles.buttonText}>{t('resources.proposalTellAgent')}</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        );
    }

    if (proposal.action === 'delete') {
        return (
            <View style={[styles.card, styles.cardDanger]}>
                <View style={styles.head}>
                    <VaultKeyIcon kind={proposal.previous.kind} size={28} />
                    <View style={styles.headText}>
                        <Text style={styles.title} numberOfLines={1}>{proposal.previous.name}</Text>
                        <Text style={styles.subtitle}>{`${vaultKindLabel(proposal.previous.kind)} · ${t('resources.deleteKey')}`}</Text>
                    </View>
                </View>
                <Text style={styles.text}>{t('resources.deleteConfirm', { name: proposal.previous.name })}</Text>
                <View style={styles.buttons}>
                    <Pressable onPress={confirm} disabled={busy} style={[styles.button, styles.danger, busy && styles.disabled]}>
                        <Text style={[styles.buttonText, styles.dangerText]}>{t('resources.deleteKey')}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    const online = devices.filter((device) => device.online).map((device) => device.id);
    const rows = proposal.action === 'add' ? addRows(proposal.key, proposal.missing, online) : editRows(proposal.key, proposal.previous, proposal.missing);
    const toneStyle = (tone?: Line['tone']) => (tone === 'add' ? styles.toneAdd : tone === 'remove' ? styles.toneRemove : null);
    return (
        <View style={styles.card}>
            <View style={styles.head}>
                <VaultKeyIcon kind={proposal.key.kind} size={28} />
                <View style={styles.headText}>
                    <Text style={styles.title} numberOfLines={1}>{proposal.key.name}</Text>
                    <Text style={styles.subtitle}>{`${vaultKindLabel(proposal.key.kind)} · ${proposal.action === 'add' ? t('resources.proposalNew') : t('resources.proposalChange')}`}</Text>
                </View>
            </View>
            <View style={styles.rows}>
                {rows.map((row, index) => (
                    <View key={`${row.label}:${index}`} style={styles.row}>
                        <Text style={[styles.rowLabel, row.mono && styles.mono]} numberOfLines={1}>{row.label}</Text>
                        <View style={styles.rowValue}>
                            {row.fill ? (
                                <TextInput
                                    value={fills[row.fill.name] ?? ''}
                                    onChangeText={(value) => setFills((current) => ({ ...current, [row.fill!.name]: value }))}
                                    secureTextEntry={row.fill.secret}
                                    multiline={row.fill.multiline}
                                    placeholder={t('resources.proposalFillHere')}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    style={[styles.input, !row.fill.secret && styles.mono, row.fill.multiline && styles.inputMultiline]}
                                />
                            ) : row.lines.map((line, lineIndex) => (
                                <Text key={lineIndex} style={[styles.rowText, line.mono && styles.mono, toneStyle(line.tone)]}>{line.text}</Text>
                            ))}
                        </View>
                    </View>
                ))}
            </View>
            <Text style={styles.hint}>{t('resources.proposalDrafted')}</Text>
            <View style={styles.buttons}>
                <Pressable onPress={confirm} disabled={busy} style={[styles.button, styles.primary, busy && styles.disabled]}>
                    <Text style={[styles.buttonText, styles.primaryText]}>{proposal.action === 'add' ? t('resources.proposalSave') : t('resources.proposalApply')}</Text>
                </Pressable>
            </View>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        marginTop: 8,
        padding: 12,
        gap: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.dark ? 'rgba(59,130,246,0.35)' : '#BFDBFE',
        backgroundColor: theme.colors.surface,
    },
    cardDanger: {
        borderColor: theme.dark ? 'rgba(239,68,68,0.4)' : '#FECACA',
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headText: {
        flex: 1,
        gap: 1,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.text,
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    rows: {
        gap: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    rowLabel: {
        ...Typography.default(),
        width: 120,
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textSecondary,
    },
    rowValue: {
        flex: 1,
        gap: 2,
    },
    rowText: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.text,
    },
    mono: {
        ...Typography.mono(),
        fontSize: 12.5,
    },
    toneAdd: {
        color: theme.dark ? '#86EFAC' : '#166534',
    },
    toneRemove: {
        color: theme.colors.textDestructive,
        textDecorationLine: 'line-through',
    },
    input: {
        ...Typography.default(),
        height: 32,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        fontSize: 13,
    },
    inputMultiline: {
        height: 80,
        paddingTop: 6,
        textAlignVertical: 'top',
    },
    hint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    bar: {
        marginTop: 8,
        padding: 10,
        gap: 8,
        borderRadius: 10,
        backgroundColor: theme.dark ? 'rgba(245,158,11,0.12)' : '#FFFBEB',
        borderWidth: 1,
        borderColor: theme.dark ? 'rgba(245,158,11,0.35)' : '#FDE68A',
    },
    barDone: {
        backgroundColor: theme.dark ? 'rgba(34,197,94,0.12)' : '#F0FDF4',
        borderColor: theme.dark ? 'rgba(34,197,94,0.35)' : '#BBF7D0',
    },
    text: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text,
    },
    done: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.dark ? '#86EFAC' : '#166534',
    },
    buttons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    button: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    primary: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    danger: {
        backgroundColor: '#DC2626',
        borderColor: '#DC2626',
    },
    disabled: {
        opacity: 0.5,
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    primaryText: {
        color: theme.colors.button.primary.tint,
    },
    dangerText: {
        color: '#FFFFFF',
    },
}));
