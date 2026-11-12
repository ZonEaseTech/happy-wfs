import * as React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
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
import { saveVaultKey } from '@/sync/vault';
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

export function VaultKeyIcon({ kind, size = 32 }: { kind: VaultKeyKind; size?: number }) {
    const { theme } = useUnistyles();
    const tile = KIND_TILES[kind];
    return (
        <View style={{ width: size, height: size, borderRadius: size / 4, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.dark ? tile.bgDark : tile.bg }}>
            {tile.icon
                ? <Ionicons name={tile.icon} size={size * 0.53} color={tile.fg} />
                : <Text style={{ ...Typography.default('semiBold'), fontSize: size * 0.38, color: tile.fg }}>{tile.mark}</Text>}
        </View>
    );
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

/** Small pill. Pressable when `onPress` is given; `selected` fills it. */
export function VaultChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
    const styles = stylesheet;
    const body = (
        <View style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
        </View>
    );
    return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

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

/** The full usage log with filters: everything, refused only, or one key. */
export const VaultUsageList = React.memo(({ logs, keys, initialFilter }: { logs: VaultUsageLog[]; keys: VaultKey[]; initialFilter?: string | null }) => {
    const [filter, setFilter] = React.useState<string>(initialFilter ?? 'all');
    React.useEffect(() => { if (initialFilter) setFilter(initialFilter); }, [initialFilter]);
    // A key that was deleted still has entries; name it from the entries themselves.
    const keyFilters = React.useMemo(() => {
        const names = new Map<string, string>();
        for (const entry of logs) if (!names.has(entry.keyId)) names.set(entry.keyId, entry.keyName);
        return [...names.entries()].map(([id, name]) => ({ id, name: keys.find((key) => key.id === id)?.name ?? name }));
    }, [logs, keys]);
    const denied = logs.filter((entry) => entry.outcome === 'denied').length;
    const entries = logs.filter((entry) => filter === 'all' || (filter === 'denied' ? entry.outcome === 'denied' : entry.keyId === filter));
    return (
        <>
            <View style={stylesheet.filters}>
                <VaultChip label={t('resources.filterAll', { count: logs.length })} selected={filter === 'all'} onPress={() => setFilter('all')} />
                <VaultChip label={t('resources.filterDenied', { count: denied })} selected={filter === 'denied'} onPress={() => setFilter('denied')} />
                {keyFilters.map((key) => <VaultChip key={key.id} label={key.name} selected={filter === key.id} onPress={() => setFilter(key.id)} />)}
            </View>
            <ItemGroup footer={t('resources.usageFooter')}>
                {entries.length === 0 && <Item title={t('resources.noUsage')} showChevron={false} />}
                {entries.map((entry) => <VaultLogItem key={`${entry.at}-${entry.command}`} entry={entry} keys={keys} />)}
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
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 13,
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
        fontSize: 13,
    },
    filters: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 14,
    },
    chip: {
        paddingHorizontal: 11,
        paddingVertical: 4,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    chipSelected: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    chipTextSelected: { color: theme.colors.button.primary.tint },
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
