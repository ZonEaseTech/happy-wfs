import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { VaultKeyKindSchema, vaultPatternToRegExp, type VaultKeyKind } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { openVaultAddKey } from '@/components/VaultAddKeyModal';
import { vaultKindLabel } from '@/components/VaultSections';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { saveVaultKey, useVault } from '@/sync/vault';

const RUN = /(?:^|[\s;&|(])happy run ([a-z0-9][a-z0-9-]*) -- ([\s\S]+)$/;
const NEED = /(?:^|[\s;&|(])happy keys need ([a-z]+)/;
/** Printed by `happy run` when a command is simply not on the key's allow list (see happy-cli run.ts). */
const NOT_ALLOWED = "not on the key's allow list";
const KIND_ALIASES: Record<string, VaultKeyKind> = { cf: 'cloudflare', ali: 'aliyun', alidns: 'aliyun', gh: 'github', server: 'ssh' };
/** Bars the user waved away, for as long as the app runs. */
const dismissed = new Set<string>();

/** Roughly what the shell handed to `happy run`: up to the first pipe, chain or redirect, quotes dropped. */
function commandAfterRun(rest: string): string {
    return rest.split(/\s(?:\|\|?|&&|;|\d?>|<)\s?/)[0].replace(/(["'])(.*?)\1/g, '$2').trim();
}

/**
 * Under a shell tool card that used the resource center: when a command was refused for not
 * being allowed, allow it in one tap and have the agent run it again; when the agent asked for
 * a key that does not exist (`happy keys need <type>`), add one and let it carry on.
 */
export const VaultToolFooter = React.memo(({ sessionId, command, result, createdAt }: { sessionId: string; command: string; result: string; createdAt: number }) => {
    const styles = stylesheet;
    const vault = useVault();
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    const [busy, setBusy] = React.useState(false);
    const run = RUN.exec(command);
    const need = NEED.exec(command);

    if (run && result.includes(NOT_ALLOWED)) {
        const key = vault.keys.find((candidate) => candidate.slug === run[1]);
        if (!key) return null;
        const parsed = commandAfterRun(run[2]);
        // The usage log has the exact command the key checked; the shell text is only a fallback.
        const logged = vault.logs.find((entry) => entry.sessionId === sessionId && entry.keyId === key.id && entry.reason === 'not-allowed' && parsed.startsWith(entry.command.replace(/["']/g, '')));
        const target = logged?.command ?? parsed;
        const id = `${sessionId}:${createdAt}:${target}`;
        if (key.allow.some((rule) => vaultPatternToRegExp(rule).test(target))) {
            return <View style={[styles.bar, styles.barDone]}><Text style={styles.done}>{`✓ ${t('resources.allowedDone', { command: target })}`}</Text></View>;
        }
        if (dismissed.has(id)) return null;
        const allow = async () => {
            setBusy(true);
            try {
                await saveVaultKey({ ...key, allow: [...key.allow, target] }, key);
                await sync.sendMessage(sessionId, t('resources.allowedRetryMessage', { command: target }));
            } catch (error) {
                Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
            } finally {
                setBusy(false);
            }
        };
        return (
            <View style={styles.bar}>
                <Text style={styles.text}>{t('resources.blockedPrompt', { name: key.name })}</Text>
                <View style={styles.buttons}>
                    <Pressable onPress={() => { void allow(); }} disabled={busy} style={[styles.button, styles.primary, busy && { opacity: 0.5 }]}>
                        <Text style={[styles.buttonText, styles.primaryText]}>{t('resources.allowAlways')}</Text>
                    </Pressable>
                    <Pressable onPress={() => { dismissed.add(id); rerender(); }} style={styles.button}>
                        <Text style={styles.buttonText}>{t('resources.dontAllow')}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    if (need) {
        const parsedKind = VaultKeyKindSchema.safeParse(KIND_ALIASES[need[1]] ?? need[1]);
        if (!parsedKind.success) return null;
        const kind = parsedKind.data;
        const added = vault.keys.find((key) => key.kind === kind && key.updatedAt >= createdAt);
        if (added) {
            return <View style={[styles.bar, styles.barDone]}><Text style={styles.done}>{`✓ ${t('resources.keyAddedDone', { name: added.name })}`}</Text></View>;
        }
        return (
            <View style={[styles.bar, styles.barNeed]}>
                <Text style={styles.text}>{t('resources.needPrompt', { kind: vaultKindLabel(kind) })}</Text>
                <View style={styles.buttons}>
                    <Pressable
                        onPress={() => openVaultAddKey(kind, (key) => {
                            sync.sendMessage(sessionId, t('resources.keyAddedMessage', { name: key.name, slug: key.slug })).catch(() => { });
                        })}
                        style={[styles.button, styles.needButton]}
                    >
                        <Text style={[styles.buttonText, styles.needText]}>{t('resources.addKind', { kind: vaultKindLabel(kind) })}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return null;
});

const stylesheet = StyleSheet.create((theme) => ({
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
    barNeed: {
        backgroundColor: theme.dark ? 'rgba(59,130,246,0.12)' : '#EFF6FF',
        borderColor: theme.dark ? 'rgba(59,130,246,0.35)' : '#BFDBFE',
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
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    primary: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    needButton: {
        backgroundColor: '#2563EB',
        borderColor: '#2563EB',
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    primaryText: {
        color: theme.colors.button.primary.tint,
    },
    needText: {
        color: '#FFFFFF',
    },
}));
