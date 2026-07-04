import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';

function generateLocalAccessCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes = new Uint8Array(10);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function BugShareSettingsModal({
    onClose,
    currentUrl,
    currentAccessCode,
    onRotate,
}: {
    onClose: () => void;
    currentUrl: string;
    currentAccessCode: string;
    onRotate: (accessCode?: string) => Promise<{ accessCode: string; url: string; version: number }>;
}) {
    const styles = stylesheet;
    const [customCode, setCustomCode] = React.useState(currentAccessCode || '');
    const [result, setResult] = React.useState<{ accessCode: string; url: string; version: number } | null>(null);
    const [busy, setBusy] = React.useState(false);

    const rotate = React.useCallback(async (useCustom: boolean) => {
        setBusy(true);
        try {
            const next = await onRotate(useCustom ? customCode.trim() : undefined);
            setResult(next);
            setCustomCode(next.accessCode);
            Modal.alert(t('common.success'), t('bug.shareCodeRotated'));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [customCode, onRotate]);

    const copy = React.useCallback((value: string) => {
        void Clipboard.setStringAsync(value);
    }, []);

    const url = result?.url || currentUrl || '/bug';
    const trimmedCode = customCode.trim();

    return (
        <View style={styles.modal}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('bug.shareSettings')}</Text>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={styles.title.color} /></Pressable>
            </View>
            <View style={styles.body}>
                <Text style={styles.label}>{t('bug.entryUrl')}</Text>
                <View style={styles.fieldRow}>
                    <Pressable style={styles.copyBox} onPress={() => copy(url)}><Text style={styles.copyText}>{url}</Text></Pressable>
                    <Pressable style={styles.copyButton} onPress={() => copy(url)} hitSlop={8}>
                        <Ionicons name="copy-outline" size={18} color={styles.copyIcon.color} />
                    </Pressable>
                </View>
                <Text style={styles.label}>{t('bug.accessCode')}</Text>
                <View style={styles.fieldRow}>
                    <TextInput style={styles.input} value={customCode} onChangeText={setCustomCode} placeholder={t('bug.emptyForRandom')} placeholderTextColor={styles.muted.color} />
                    <Pressable disabled={!trimmedCode} style={[styles.copyButton, !trimmedCode && styles.copyButtonDisabled]} onPress={() => copy(customCode.trim())} hitSlop={8}>
                        <Ionicons name="copy-outline" size={18} color={styles.copyIcon.color} />
                    </Pressable>
                </View>
                <Text style={styles.warning}>{t('bug.shareCodeRotated')}</Text>
                <View style={styles.row}>
                    <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => setCustomCode(generateLocalAccessCode())}><Text style={styles.secondaryButtonText}>{t('bug.generateRandom')}</Text></Pressable>
                    <Pressable disabled={busy || !trimmedCode} style={styles.primaryButton} onPress={() => rotate(true)}><Text style={styles.primaryButtonText}>{t('bug.saveCustomCode')}</Text></Pressable>
                </View>
            </View>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: { width: Math.min(520, (typeof window !== 'undefined' ? window.innerWidth : 520) - 32), backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
    title: { color: theme.colors.text, fontSize: 18, ...Typography.default('semiBold') },
    body: { padding: 16 },
    label: { color: theme.colors.text, marginTop: 10, marginBottom: 8, ...Typography.default('semiBold') },
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    copyBox: { flex: 1, backgroundColor: theme.colors.surfaceHigh, borderRadius: 12, padding: 12 },
    copyText: { color: theme.colors.text, ...Typography.default() },
    copyButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceHigh },
    copyButtonDisabled: { opacity: 0.45 },
    copyIcon: { color: theme.colors.text },
    input: { flex: 1, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, padding: 12, color: theme.colors.text, backgroundColor: theme.colors.input.background, ...Typography.default() },
    muted: { color: theme.colors.textSecondary, ...Typography.default() },
    warning: { color: theme.colors.textSecondary, lineHeight: 20, marginTop: 12, ...Typography.default() },
    row: { flexDirection: 'row', gap: 10, marginTop: 16 },
    secondaryButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh },
    secondaryButtonText: { color: theme.colors.text, ...Typography.default('semiBold') },
    primaryButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.colors.button.primary.background },
    primaryButtonText: { color: theme.colors.button.primary.tint, ...Typography.default('semiBold') },
}));
