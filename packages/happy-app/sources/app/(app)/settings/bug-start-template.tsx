import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { RoundButton } from '@/components/RoundButton';
import { layout } from '@/components/layout';
import { useDesktopRoute } from '@/components/desktopRoutes';
import { Typography } from '@/constants/Typography';
import { useSettingMutable } from '@/sync/storage';
import { defaultBugReportStartPromptTemplate } from '@/utils/bugReportStartPromptTemplate';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    keyboardAvoidingView: { flex: 1 },
    contentContainer: {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 12,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center' as const,
    },
    labelText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    textInput: {
        backgroundColor: theme.colors.input.background,
        padding: 12,
        borderRadius: 8,
        marginBottom: 10,
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.input.text,
        minHeight: 260,
        textAlignVertical: 'top' as const,
    },
    helpText: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        marginBottom: 12,
    },
    tokenText: {
        ...Typography.mono(),
        color: theme.colors.text,
    },
    buttonRow: {
        flexDirection: 'row' as const,
        gap: 12,
    },
    buttonWrapper: { flex: 1 },
}));

export default function BugReportStartTemplateSettingsScreen() {
    const { theme } = useUnistyles();
    const { dismiss } = useDesktopRoute();
    const styles = stylesheet;
    const [template, setTemplate] = useSettingMutable('bugReportStartPromptTemplate');
    const [input, setInput] = useState(template || defaultBugReportStartPromptTemplate);

    const handleRestoreDefault = () => {
        setInput(defaultBugReportStartPromptTemplate);
    };

    const handleSave = () => {
        const nextTemplate = input.trim() || defaultBugReportStartPromptTemplate;
        setTemplate(nextTemplate);
        dismiss();
    };

    return (
        <KeyboardAvoidingView
            style={styles.keyboardAvoidingView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ItemList style={{ flex: 1, paddingTop: 0 }}>
                <ItemGroup footer={t('settingsFeatures.bugReportStartPromptTemplateFooter')}>
                    <View style={styles.contentContainer}>
                        <Text style={styles.labelText}>{t('settingsFeatures.bugReportStartPromptTemplate')}</Text>
                        <TextInput
                            style={styles.textInput}
                            value={input}
                            onChangeText={setInput}
                            placeholder={defaultBugReportStartPromptTemplate}
                            multiline
                            autoCapitalize="sentences"
                            autoCorrect={false}
                            placeholderTextColor={theme.colors.textSecondary}
                        />
                        <Text style={styles.helpText}>
                            {t('settingsFeatures.bugReportStartPromptTemplateVariables')}{' '}
                            <Text style={styles.tokenText}>{'{bugId}'}</Text>{' '}
                            <Text style={styles.tokenText}>{'{bugTitle}'}</Text>{' '}
                            <Text style={styles.tokenText}>{'{bugAuthor}'}</Text>{' '}
                            <Text style={styles.tokenText}>{'{bugDescription}'}</Text>{' '}
                            <Text style={styles.tokenText}>{'{bugAttachments}'}</Text>{' '}
                            <Text style={styles.tokenText}>{'{bugComments}'}</Text>
                        </Text>
                        <View style={styles.buttonRow}>
                            <View style={styles.buttonWrapper}>
                                <RoundButton
                                    title={t('settingsFeatures.restoreDefaultTemplate')}
                                    size="normal"
                                    display="inverted"
                                    onPress={handleRestoreDefault}
                                />
                            </View>
                            <View style={styles.buttonWrapper}>
                                <RoundButton
                                    title={t('common.save')}
                                    size="normal"
                                    onPress={handleSave}
                                />
                            </View>
                        </View>
                    </View>
                </ItemGroup>
            </ItemList>
        </KeyboardAvoidingView>
    );
}
