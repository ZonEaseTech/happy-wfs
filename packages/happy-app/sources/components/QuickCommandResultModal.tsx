import * as React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import * as Clipboard from 'expo-clipboard';
import { showCopiedToast } from '@/components/Toast';
import { t } from '@/text';

export interface QuickCommandRun {
    title: string;
    command: string;
    running: boolean;
    output: string;
    failed: boolean;
}

/**
 * Result surface for quick commands launched from the session header on
 * phones: shows a spinner while the command runs on the machine, then the
 * combined stdout/stderr in a scrollable monospace block that can be copied.
 */
export const QuickCommandResultModal = React.memo(({ run, onClose }: {
    run: QuickCommandRun | null;
    onClose: () => void;
}) => {
    const { theme } = useUnistyles();
    if (!run) return null;

    const handleCopy = async () => {
        await Clipboard.setStringAsync(run.output || run.command);
        showCopiedToast();
    };

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 16 }}>
                <View style={{
                    maxHeight: '80%',
                    borderRadius: 16,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.surface,
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                    }}>
                        {run.running ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <Ionicons
                                name={run.failed ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                                size={18}
                                color={run.failed ? theme.colors.textDestructive : theme.colors.success}
                            />
                        )}
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                            {run.title}
                        </Text>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    <Text
                        numberOfLines={2}
                        style={{
                            paddingHorizontal: 16,
                            paddingTop: 10,
                            fontSize: 12,
                            color: theme.colors.textSecondary,
                            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
                        }}
                    >
                        {run.command}
                    </Text>

                    <ScrollView style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                        <Text
                            selectable
                            style={{
                                fontSize: 13,
                                lineHeight: 19,
                                color: theme.colors.text,
                                fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
                            }}
                        >
                            {run.running ? t('terminal.quickCommandsRunning') : (run.output || '—')}
                        </Text>
                    </ScrollView>

                    <View style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        gap: 8,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.divider,
                    }}>
                        {!run.running && !!run.output && (
                            <Pressable onPress={() => { void handleCopy(); }} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                                <Text style={{ color: theme.colors.textLink, fontSize: 15 }}>{t('common.copy')}</Text>
                            </Pressable>
                        )}
                        <Pressable onPress={onClose} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                            <Text style={{ color: theme.colors.textLink, fontSize: 15, fontWeight: '600' }}>{t('common.ok')}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
});
