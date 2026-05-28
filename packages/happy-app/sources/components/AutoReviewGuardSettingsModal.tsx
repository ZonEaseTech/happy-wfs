import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import type { AutoReviewGuard } from '@/sync/autoReviewGuard';
import { normalizeAutoReviewGuardSettings, saveAutoReviewGuard } from '@/sync/autoReviewGuard';
import type { AutoReviewGuardSettings } from '@/sync/settings';
import { autoReviewGuardSettingsDefaults } from '@/sync/settings';

type Props = {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    guard?: AutoReviewGuard;
    defaults: AutoReviewGuardSettings;
};

function splitLines(value: string): string[] {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function lineText(values: string[] | undefined): string {
    return (values && values.length > 0 ? values : autoReviewGuardSettingsDefaults.triggerPhrases).join('\n');
}

export function AutoReviewGuardSettingsModal({ visible, onClose, sessionId, guard, defaults }: Props) {
    const { theme } = useUnistyles();
    const [enabled, setEnabled] = React.useState(false);
    const [delaySeconds, setDelaySeconds] = React.useState('5');
    const [triggerText, setTriggerText] = React.useState('');
    const [reviewPrompt, setReviewPrompt] = React.useState('');
    const [followUpTemplate, setFollowUpTemplate] = React.useState('');
    const [sendSimplifyOnPass, setSendSimplifyOnPass] = React.useState(true);

    React.useEffect(() => {
        if (!visible) return;
        const merged = normalizeAutoReviewGuardSettings({ ...defaults, ...guard });
        setEnabled(guard?.enabled ?? defaults.enabled ?? false);
        setDelaySeconds(String(Math.max(0, Math.round((merged.delayMs ?? 5_000) / 1000))));
        setTriggerText(lineText(merged.triggerPhrases));
        setReviewPrompt(merged.reviewPrompt);
        setFollowUpTemplate(merged.followUpTemplate);
        setSendSimplifyOnPass(merged.sendSimplifyOnPass);
    }, [visible, guard, defaults]);

    const buildSettings = React.useCallback((): AutoReviewGuardSettings => {
        const seconds = Number(delaySeconds);
        return normalizeAutoReviewGuardSettings({
            delayMs: Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : autoReviewGuardSettingsDefaults.delayMs,
            triggerPhrases: splitLines(triggerText),
            reviewPrompt,
            followUpTemplate,
            sendSimplifyOnPass,
        });
    }, [delaySeconds, triggerText, reviewPrompt, followUpTemplate, sendSimplifyOnPass]);

    const handleSaveSession = React.useCallback(async () => {
        const settings = buildSettings();
        const next: AutoReviewGuard = {
            ...guard,
            enabled,
            status: enabled ? (guard?.status === 'needs_follow_up' ? 'idle' : guard?.status ?? 'idle') : 'idle',
            updatedAt: Date.now(),
            delayMs: settings.delayMs,
            triggerPhrases: settings.triggerPhrases,
            reviewPrompt: settings.reviewPrompt,
            followUpTemplate: settings.followUpTemplate,
            sendSimplifyOnPass: settings.sendSimplifyOnPass,
            simplifyPending: false,
        };
        await saveAutoReviewGuard(sessionId, next);
        showToast(t('sessionInfo.autoReviewGuardSavedSession'));
        onClose();
    }, [buildSettings, enabled, followUpTemplate, guard, onClose, reviewPrompt, sendSimplifyOnPass, sessionId, triggerText]);

    const handleSaveDefault = React.useCallback(() => {
        const settings = buildSettings();
        sync.applySettings({ autoReviewGuardDefaults: { ...settings, enabled } });
        showToast(t('sessionInfo.autoReviewGuardSavedDefault'));
    }, [buildSettings, enabled]);

    const handleRestoreDefaults = React.useCallback(() => {
        setEnabled(autoReviewGuardSettingsDefaults.enabled);
        setDelaySeconds(String(Math.round(autoReviewGuardSettingsDefaults.delayMs / 1000)));
        setTriggerText(lineText(autoReviewGuardSettingsDefaults.triggerPhrases));
        setReviewPrompt(autoReviewGuardSettingsDefaults.reviewPrompt);
        setFollowUpTemplate(autoReviewGuardSettingsDefaults.followUpTemplate);
        setSendSimplifyOnPass(autoReviewGuardSettingsDefaults.sendSimplifyOnPass);
    }, []);

    if (!visible) return null;

    const inputBase = {
        color: theme.colors.text,
        backgroundColor: theme.colors.input.background,
        borderColor: theme.colors.divider,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        ...Typography.default(),
        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
    };

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' }}>
                <Pressable
                    onPress={(event) => event.stopPropagation?.()}
                    style={{
                        width: '92%',
                        maxWidth: 760,
                        maxHeight: '88%',
                        backgroundColor: theme.colors.surface,
                        borderRadius: 16,
                        overflow: 'hidden',
                    }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: theme.colors.divider }}>
                        <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.text} style={{ marginRight: 8 }} />
                        <Text style={{ flex: 1, fontSize: 17, color: theme.colors.text, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardSettings')}</Text>
                        <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={theme.colors.textSecondary} /></Pressable>
                    </View>

                    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 18, gap: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 15, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardEnabledLabel')}</Text>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3, ...Typography.default() }}>{t('sessionInfo.autoReviewGuardEnabledHint')}</Text>
                            </View>
                            <Switch value={enabled} onValueChange={setEnabled} />
                        </View>

                        <View>
                            <Text style={{ color: theme.colors.text, fontSize: 13, marginBottom: 6, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardDelay')}</Text>
                            <TextInput value={delaySeconds} onChangeText={setDelaySeconds} keyboardType="numeric" style={[inputBase, { height: 42 }]} placeholder="5" placeholderTextColor={theme.colors.textSecondary} />
                        </View>

                        <View>
                            <Text style={{ color: theme.colors.text, fontSize: 13, marginBottom: 6, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardTriggers')}</Text>
                            <TextInput multiline value={triggerText} onChangeText={setTriggerText} style={[inputBase, { minHeight: 110, textAlignVertical: 'top' }]} placeholder={t('sessionInfo.autoReviewGuardTriggersPlaceholder')} placeholderTextColor={theme.colors.textSecondary} />
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 13, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardSimplifyOnPass')}</Text>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3, ...Typography.default() }}>{t('sessionInfo.autoReviewGuardSimplifyOnPassHint')}</Text>
                            </View>
                            <Switch value={sendSimplifyOnPass} onValueChange={setSendSimplifyOnPass} />
                        </View>

                        <View>
                            <Text style={{ color: theme.colors.text, fontSize: 13, marginBottom: 6, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardReviewPrompt')}</Text>
                            <TextInput multiline value={reviewPrompt} onChangeText={setReviewPrompt} style={[inputBase, { minHeight: 150, textAlignVertical: 'top' }]} />
                        </View>

                        <View>
                            <Text style={{ color: theme.colors.text, fontSize: 13, marginBottom: 6, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardFollowUpTemplate')}</Text>
                            <TextInput multiline value={followUpTemplate} onChangeText={setFollowUpTemplate} style={[inputBase, { minHeight: 120, textAlignVertical: 'top' }]} />
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 5, ...Typography.default() }}>{t('sessionInfo.autoReviewGuardTemplateHint')}</Text>
                        </View>
                    </ScrollView>

                    <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: theme.colors.divider }}>
                        <Pressable onPress={handleRestoreDefaults} style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderRightWidth: 0.5, borderRightColor: theme.colors.divider }}>
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 15, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardRestoreDefaults')}</Text>
                        </Pressable>
                        <Pressable onPress={handleSaveDefault} style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderRightWidth: 0.5, borderRightColor: theme.colors.divider }}>
                            <Text style={{ color: theme.colors.textLink, fontSize: 15, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardSaveDefault')}</Text>
                        </Pressable>
                        <Pressable onPress={handleSaveSession} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textLink, fontSize: 15, ...Typography.default('semiBold') }}>{t('sessionInfo.autoReviewGuardSaveSession')}</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}
