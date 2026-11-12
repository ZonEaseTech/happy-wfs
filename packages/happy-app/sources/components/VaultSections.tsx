import * as React from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { isVaultCommandLearnable, type VaultKey, type VaultKeyKind, type VaultUsageLog } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { useDesktopRoutes } from '@/components/desktopRoutes';
import { showToast } from '@/components/Toast';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { refreshVault, saveVaultKey, useVault } from '@/sync/vault';
import { formatLastSeen, getSessionName } from '@/utils/sessionUtils';

export const vaultKindLabel = (kind: VaultKeyKind): string => ({
    cloudflare: t('resources.kindCloudflare'),
    aliyun: t('resources.kindAliyun'),
    github: t('resources.kindGithub'),
    npm: t('resources.kindNpm'),
    ssh: t('resources.kindSsh'),
    custom: t('resources.kindCustom'),
})[kind];

export function vaultMachineName(machineId: string): string {
    const machine = storage.getState().machines[machineId];
    return machine?.metadata?.displayName || machine?.metadata?.host || machineId.slice(0, 8);
}

/** Tile colour and mark per key type, so a list of keys can be told apart at a glance. */
const KIND_TILES: Record<VaultKeyKind, { fg: string; bg: string; bgDark: string; mark?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }> = {
    cloudflare: { fg: '#F38020', bg: '#FFF1E6', bgDark: 'rgba(243,128,32,0.2)', mark: 'CF' },
    aliyun: { fg: '#FF6A00', bg: '#FFF0E5', bgDark: 'rgba(255,106,0,0.2)', mark: '阿' },
    github: { fg: '#6B7280', bg: '#F3F4F6', bgDark: 'rgba(156,163,175,0.2)', mark: 'GH' },
    npm: { fg: '#CB3837', bg: '#FDECEC', bgDark: 'rgba(203,56,55,0.2)', mark: 'npm' },
    ssh: { fg: '#2563EB', bg: '#E8F0FE', bgDark: 'rgba(37,99,235,0.25)', icon: 'server-outline' },
    custom: { fg: '#7C3AED', bg: '#F1EBFE', bgDark: 'rgba(124,58,237,0.22)', icon: 'key-outline' },
};

export function VaultKeyIcon({ kind }: { kind: VaultKeyKind }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const tile = KIND_TILES[kind];
    return (
        <View style={[styles.kindTile, { backgroundColor: theme.dark ? tile.bgDark : tile.bg }]}>
            {tile.icon
                ? <Ionicons name={tile.icon} size={17} color={tile.fg} />
                : <Text style={[styles.kindMark, { color: tile.fg }]}>{tile.mark}</Text>}
        </View>
    );
}

/** Devices that receive a copy: the via device for server logins, the ticked ones otherwise. */
export const vaultKeyDeviceCount = (key: VaultKey) => (key.ssh ? 1 : key.machineIds.length);

/** "3 allowed · 1 denied", or "any command" when the allow list is a bare `*`. */
export function vaultRuleSummary(key: VaultKey): string {
    const allow = key.allow.includes('*') ? t('resources.anyCommand') : t('resources.allowCount', { count: key.allow.length });
    return key.deny.length ? `${allow} · ${t('resources.denyCount', { count: key.deny.length })}` : allow;
}

/** Group header with a count next to the title and an optional link on the right. */
export function VaultSectionTitle({ title, note, link, onLink }: { title: string; note?: string; link?: string; onLink?: () => void }) {
    const styles = stylesheet;
    return (
        <View style={styles.sectionTitle}>
            <Text style={styles.sectionTitleText}>{title}</Text>
            {!!note && <Text style={styles.sectionNote} numberOfLines={1}>{note}</Text>}
            <View style={{ flex: 1 }} />
            {!!link && (
                <Pressable onPress={onLink} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.sectionLink}>{link}</Text>
                </Pressable>
            )}
        </View>
    );
}

export type VaultChipTone = 'default' | 'slug' | 'code' | 'rule' | 'deny' | 'protected' | 'warn';

/** Small tag. Pressable when `onPress` is given, removable when `onRemove` is given. */
export function VaultChip({ label, tone = 'default', selected, checked, onPress, onRemove }: {
    label: string;
    tone?: VaultChipTone;
    selected?: boolean;
    /** Show a checkmark too, for multi-select chips. */
    checked?: boolean;
    onPress?: () => void;
    onRemove?: () => void;
}) {
    const styles = stylesheet;
    const box = { default: null, slug: styles.chipSlug, code: null, rule: styles.chipRule, deny: styles.chipDeny, protected: styles.chipProtected, warn: styles.chipWarn }[tone];
    const text = { default: null, slug: styles.chipTextSlug, code: styles.chipTextMono, rule: styles.chipTextRule, deny: styles.chipTextDeny, protected: styles.chipTextProtected, warn: styles.chipTextWarn }[tone];
    const body = (
        <View style={[styles.chip, box, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, text, selected && styles.chipTextSelected]} numberOfLines={1}>
                {label}{checked ? ' ✓' : ''}
            </Text>
            {onRemove && (
                <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('resources.remove')}>
                    <Text style={styles.chipRemove}>✕</Text>
                </Pressable>
            )}
        </View>
    );
    return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

/** One key in the resource center list: name, tags for its name/coverage/rules, devices and last use. */
const VaultKeyRow = React.memo(({ vaultKey, lastUsedAt, onPress, showDivider }: {
    vaultKey: VaultKey;
    lastUsedAt: number | null;
    onPress: () => void;
    showDivider?: boolean;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const used = lastUsedAt ? t('resources.lastUsed', { when: formatLastSeen(lastUsedAt) }) : t('resources.neverUsed');
    const meta = `${t('resources.deviceCountShort', { count: vaultKeyDeviceCount(vaultKey) })} · ${used}`;
    // Phones keep the tags on one line by moving devices and last use under them.
    const narrow = useWindowDimensions().width < 600;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.keyRow, pressed && { backgroundColor: theme.colors.surfacePressed }]}>
            <View style={styles.keyIcon}><VaultKeyIcon kind={vaultKey.kind} /></View>
            <View style={styles.keyBody}>
                <Text style={styles.keyName} numberOfLines={1}>{vaultKey.name}</Text>
                <View style={styles.chips}>
                    <VaultChip label={vaultKey.slug} tone="slug" />
                    {vaultKey.scope.map((scope) => <VaultChip key={scope.name} label={scope.name} />)}
                    <VaultChip label={vaultRuleSummary(vaultKey)} tone="rule" />
                </View>
                {narrow && <Text style={[styles.keyMeta, styles.keyMetaBelow]} numberOfLines={1}>{meta}</Text>}
            </View>
            {!narrow && <Text style={styles.keyMeta} numberOfLines={2}>{meta}</Text>}
            <Ionicons name="chevron-forward" size={18} color={theme.colors.groupped.chevron} />
            {showDivider && <View style={styles.divider} />}
        </Pressable>
    );
});

/**
 * One usage entry: the command, then time · key · session · device. The session opens the
 * conversation that ran it; a command refused only for not being allowed can be allowed in one tap.
 */
export const VaultLogItem = React.memo(({ entry, keys, onPress, showDivider }: {
    entry: VaultUsageLog;
    keys: VaultKey[];
    onPress?: () => void;
    showDivider?: boolean;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { dismissAll } = useDesktopRoutes();
    const navigateToSession = useNavigateToSession();
    const key = keys.find((candidate) => candidate.id === entry.keyId);
    const learnable = !!key && entry.outcome === 'denied' && isVaultCommandLearnable(key, entry.command) && !key.allow.includes(entry.command);
    const outcome = entry.outcome === 'ok'
        ? `${t('resources.outcomeOk')}${entry.durationMs !== null ? ` · ${t('resources.seconds', { count: Math.max(1, Math.round(entry.durationMs / 1000)) })}` : ''}`
        : entry.outcome === 'failed'
            ? `${t('resources.outcomeFailed')} · ${entry.exitCode ?? '?'}`
            : `${t('resources.outcomeDenied')}: ${t(entry.reason === 'guard' ? 'resources.reasonGuard' : entry.reason === 'deny' ? 'resources.reasonDeny' : 'resources.reasonNotAllowed')}`;
    const color = entry.outcome === 'ok' ? '#16A34A' : entry.outcome === 'failed' ? theme.colors.textDestructive : '#B45309';
    const narrow = useWindowDimensions().width < 600;
    const session = entry.sessionId ? storage.getState().sessions[entry.sessionId] : null;
    const sessionName = session ? getSessionName(session) : t('resources.sessionFallback');

    const allow = async () => {
        if (!key) return;
        try {
            await saveVaultKey({ ...key, allow: [...key.allow, entry.command] }, key);
            showToast(t('resources.commandAllowed', { command: entry.command }));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    };

    const openSession = (event?: { stopPropagation?: () => void }) => {
        event?.stopPropagation?.();
        if (!entry.sessionId) return;
        dismissAll();
        navigateToSession(entry.sessionId);
    };

    return (
        <Item
            title={entry.command}
            titleStyle={styles.command}
            subtitle={(
                <>
                    {`${formatLastSeen(entry.at)} · ${entry.keyName}`}
                    {entry.sessionId && (
                        <>
                            {' · '}
                            <Text style={styles.sessionLink} onPress={openSession} numberOfLines={1}>{sessionName}</Text>
                        </>
                    )}
                    {` · ${vaultMachineName(entry.machineId)}`}
                </>
            )}
            subtitleLines={2}
            onPress={onPress}
            showDivider={showDivider}
            rightElement={(
                <View style={[styles.right, narrow && { maxWidth: 110 }]}>
                    <Text style={[styles.outcome, { color }]} numberOfLines={2}>{outcome}</Text>
                    {learnable && (
                        <Pressable onPress={() => { void allow(); }} hitSlop={8} accessibilityRole="button" style={styles.allowButton}>
                            <Text style={styles.allow}>{t('resources.allowThis')}</Text>
                        </Pressable>
                    )}
                </View>
            )}
            showChevron={false}
        />
    );
});

/** The resource center's own sections: keys, then the latest usage. */
export const VaultSections = React.memo(() => {
    const { open } = useDesktopRoutes();
    const vault = useVault();
    React.useEffect(() => { refreshVault().catch(() => { }); }, []);
    const lastUse = React.useMemo(() => {
        const latest = new Map<string, number>();
        for (const entry of vault.logs) {
            if (entry.outcome !== 'denied' && entry.at > (latest.get(entry.keyId) ?? 0)) latest.set(entry.keyId, entry.at);
        }
        return latest;
    }, [vault.logs]);
    const denied = vault.logs.filter((entry) => entry.outcome === 'denied').length;
    const openUsage = () => open('/devices/usage', { title: t('resources.usage') });
    const addKey = () => open('/devices/key-edit', { title: t('resources.newKey') });

    return (
        <>
            <ItemGroup
                title={<VaultSectionTitle title={t('resources.keys')} note={t('resources.keyCount', { count: vault.keys.length })} />}
                footer={t('resources.keysFooter')}
            >
                {vault.keys.length === 0 && <Item title={t('resources.emptyKeys')} subtitle={t('resources.emptyKeysHint')} onPress={addKey} />}
                {vault.keys.map((key) => (
                    <VaultKeyRow
                        key={key.id}
                        vaultKey={key}
                        lastUsedAt={lastUse.get(key.id) ?? null}
                        onPress={() => open(`/devices/key?id=${key.id}`, { title: key.name })}
                    />
                ))}
            </ItemGroup>

            <ItemGroup
                title={(
                    <VaultSectionTitle
                        title={t('resources.usage')}
                        note={vault.logs.length ? t('resources.usageSummary', { count: vault.logs.length, denied }) : undefined}
                        link={vault.logs.length ? t('resources.all') : undefined}
                        onLink={openUsage}
                    />
                )}
                footer={t('resources.usageFooter')}
            >
                {vault.logs.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {vault.logs.slice(0, 3).map((entry) => (
                    <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={vault.keys} onPress={openUsage} />
                ))}
            </ItemGroup>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    sectionTitle: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    sectionTitleText: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        textTransform: 'uppercase',
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
    },
    sectionNote: {
        ...Typography.default(),
        flexShrink: 1,
        color: theme.colors.textSecondary,
        fontSize: 12.5,
    },
    sectionLink: {
        ...Typography.default(),
        color: theme.colors.textLink,
        fontSize: 13.5,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 4,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: theme.colors.surfaceHighest,
        maxWidth: '100%',
    },
    chipSlug: { backgroundColor: theme.dark ? '#E5E7EB' : '#1F2937' },
    chipRule: { backgroundColor: theme.dark ? 'rgba(99,102,241,0.22)' : '#EEF2FF' },
    chipDeny: { backgroundColor: theme.dark ? 'rgba(239,68,68,0.18)' : '#FEF2F2' },
    chipProtected: { backgroundColor: theme.dark ? 'rgba(239,68,68,0.18)' : '#FEE2E2' },
    chipWarn: { borderColor: '#F59E0B', borderStyle: 'dashed', backgroundColor: theme.dark ? 'rgba(245,158,11,0.12)' : '#FFFBEB' },
    chipSelected: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
        borderStyle: 'solid',
    },
    chipText: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.text,
        flexShrink: 1,
    },
    chipTextMono: { fontFamily: 'IBMPlexMono-Regular', fontSize: 12 },
    chipTextSlug: { fontFamily: 'IBMPlexMono-Regular', fontSize: 12, color: theme.dark ? '#111827' : '#FFFFFF' },
    chipTextWarn: { color: '#B45309' },
    chipTextRule: { color: theme.dark ? '#C7D2FE' : '#4338CA' },
    chipTextDeny: { fontFamily: 'IBMPlexMono-Regular', fontSize: 12, color: theme.colors.textDestructive },
    chipTextProtected: { color: theme.colors.textDestructive, ...Typography.default('semiBold') },
    chipTextSelected: { color: theme.colors.button.primary.tint },
    chipRemove: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    keyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 11,
        backgroundColor: theme.colors.surface,
    },
    keyIcon: {
        width: Platform.select({ ios: 29, default: 32 }),
        alignItems: 'center',
    },
    kindTile: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    kindMark: {
        ...Typography.default('semiBold'),
        fontSize: 12.5,
    },
    keyBody: {
        flex: 1,
        minWidth: 0,
    },
    keyName: {
        ...Typography.default(),
        fontSize: Platform.select({ ios: 17, default: 16 }),
        color: theme.colors.text,
    },
    keyMeta: {
        ...Typography.default(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        textAlign: 'right',
        maxWidth: 120,
    },
    keyMetaBelow: {
        textAlign: 'left',
        maxWidth: undefined,
        marginTop: 4,
    },
    divider: {
        position: 'absolute',
        left: 58,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    command: {
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 13,
    },
    sessionLink: {
        color: theme.colors.textLink,
    },
    right: {
        alignItems: 'flex-end',
        gap: 4,
        maxWidth: 170,
    },
    outcome: {
        fontSize: 12,
        textAlign: 'right',
    },
    allowButton: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.textLink,
    },
    allow: {
        fontSize: 12.5,
        color: theme.colors.textLink,
    },
}));
