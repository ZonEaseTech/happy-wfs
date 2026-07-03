import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';

export function BugShareSettingsModal({
    onClose,
    currentUrl,
    onRotate,
}: {
    onClose: () => void;
    currentUrl: string;
    onRotate: (accessCode?: string) => Promise<{ accessCode: string; url: string; version: number }>;
}) {
    const styles = stylesheet;
    const [customCode, setCustomCode] = React.useState('');
    const [result, setResult] = React.useState<{ accessCode: string; url: string; version: number } | null>(null);
    const [busy, setBusy] = React.useState(false);

    const rotate = React.useCallback(async (useCustom: boolean) => {
        setBusy(true);
        try {
            const next = await onRotate(useCustom ? customCode.trim() : undefined);
            setResult(next);
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

    return (
        <View style={styles.modal}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('bug.shareSettings')}</Text>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={styles.title.color} /></Pressable>
            </View>
            <View style={styles.body}>
                <Text style={styles.label}>{t('bug.entryUrl')}</Text>
                <Pressable style={styles.copyBox} onPress={() => copy(url)}><Text style={styles.copyText}>{url}</Text></Pressable>
                <Text style={styles.label}>{t('bug.accessCode')}</Text>
                <TextInput style={styles.input} value={customCode} onChangeText={setCustomCode} placeholder={t('bug.emptyForRandom')} placeholderTextColor={styles.muted.color} />
                {result && (
                    <Pressable style={styles.codeBox} onPress={() => copy(result.accessCode)}>
                        <Text style={styles.code}>{result.accessCode}</Text>
                        <Text style={styles.muted}>{t('bug.tapToCopyShownOnce')}</Text>
                    </Pressable>
                )}
                <Text style={styles.warning}>{t('bug.shareCodeRotated')}</Text>
                <View style={styles.row}>
                    <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => rotate(false)}><Text style={styles.secondaryButtonText}>{t('bug.generateRandom')}</Text></Pressable>
                    <Pressable disabled={busy || !customCode.trim()} style={styles.primaryButton} onPress={() => rotate(true)}><Text style={styles.primaryButtonText}>{t('bug.saveCustomCode')}</Text></Pressable>
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
    copyBox: { backgroundColor: theme.colors.surfaceHigh, borderRadius: 12, padding: 12 },
    copyText: { color: theme.colors.text, ...Typography.default() },
    input: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, padding: 12, color: theme.colors.text, backgroundColor: theme.colors.input.background, ...Typography.default() },
    muted: { color: theme.colors.textSecondary, ...Typography.default() },
    codeBox: { alignItems: 'center', backgroundColor: theme.colors.surfaceHigh, borderRadius: 14, padding: 16, marginTop: 12 },
    code: { color: theme.colors.text, fontSize: 22, letterSpacing: 2, ...Typography.default('semiBold') },
    warning: { color: theme.colors.textSecondary, lineHeight: 20, marginTop: 12, ...Typography.default() },
    row: { flexDirection: 'row', gap: 10, marginTop: 16 },
    secondaryButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh },
    secondaryButtonText: { color: theme.colors.text, ...Typography.default('semiBold') },
    primaryButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.colors.button.primary.background },
    primaryButtonText: { color: theme.colors.button.primary.tint, ...Typography.default('semiBold') },
}));
