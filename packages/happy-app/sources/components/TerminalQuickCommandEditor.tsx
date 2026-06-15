import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';

export interface QuickCommandEditResult {
    title: string;
    command: string;
}

interface QuickCommandEditModalProps {
    title: string;
    initialName?: string;
    initialCommand?: string;
    onComplete: (result: QuickCommandEditResult | null) => void;
}

const MAX_WIDTH = 720;
const MONOSPACE = Platform.select({
    web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
}) as string;

// Single dialog that edits a terminal quick command's display name and command
// together. Replaces the previous two sequential Modal.prompt calls so long,
// multi-line commands get a roomy editing area in one larger window.
function QuickCommandEditModal({ title, initialName, initialCommand, onComplete }: QuickCommandEditModalProps) {
    const { theme } = useUnistyles();
    const window = useWindowDimensions();
    const [name, setName] = useState(initialName ?? '');
    const [command, setCommand] = useState(initialCommand ?? '');
    const settledRef = useRef(false);
    const nameRef = useRef<TextInput>(null);
    const commandRef = useRef<TextInput>(null);

    const complete = (result: QuickCommandEditResult | null) => {
        if (settledRef.current) return;
        settledRef.current = true;
        onComplete(result);
    };

    // Backdrop / hardware-back dismissal unmounts us without pressing a button;
    // resolve as cancel so the awaiting caller never hangs.
    useEffect(() => {
        return () => {
            if (!settledRef.current) {
                settledRef.current = true;
                onComplete(null);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Focus the command field when editing (the long value users came to fix),
    // otherwise start at the name field for a fresh entry.
    useEffect(() => {
        const ref = initialCommand ? commandRef : nameRef;
        const timer = setTimeout(() => ref.current?.focus(), 100);
        return () => clearTimeout(timer);
    }, [initialCommand]);

    const handleSave = () => {
        const trimmedTitle = name.trim();
        const trimmedCommand = command.trim();
        if (!trimmedTitle || !trimmedCommand) return;
        complete({ title: trimmedTitle, command: trimmedCommand });
    };

    const canSave = name.trim().length > 0 && command.trim().length > 0;

    const modalWidth = Math.min(MAX_WIDTH, Math.max(280, Math.floor(window.width * 0.94)));
    const modalMaxHeight = Math.max(320, Math.floor(window.height * 0.9));
    const commandHeight = Math.max(160, Math.floor(window.height * 0.32));

    const styles = StyleSheet.create({
        container: {
            backgroundColor: theme.colors.surface,
            borderRadius: 14,
            width: modalWidth,
            maxHeight: modalMaxHeight,
            overflow: 'hidden',
            shadowColor: theme.colors.shadow.color,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5,
        },
        scroll: {
            flexGrow: 0,
            flexShrink: 1,
        },
        content: {
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 16,
        },
        title: {
            fontSize: 17,
            textAlign: 'center',
            color: theme.colors.text,
            marginBottom: 16,
        },
        label: {
            fontSize: 13,
            color: theme.colors.textSecondary,
            marginBottom: 6,
        },
        labelSpaced: {
            marginTop: 18,
        },
        input: {
            width: '100%',
            borderWidth: 1,
            borderColor: theme.colors.divider,
            borderRadius: 8,
            paddingHorizontal: 12,
            fontSize: 15,
            color: theme.colors.text,
            backgroundColor: theme.colors.input.background,
        },
        nameInput: {
            height: 40,
        },
        commandInput: {
            height: commandHeight,
            paddingTop: 10,
            paddingBottom: 10,
            textAlignVertical: 'top',
            fontFamily: MONOSPACE,
            fontSize: 14,
            lineHeight: 20,
        },
        buttonContainer: {
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            flexDirection: 'row',
            flexShrink: 0,
            minHeight: 52,
        },
        button: {
            flex: 1,
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
        },
        buttonPressed: {
            backgroundColor: theme.colors.divider,
        },
        buttonSeparator: {
            width: 1,
            backgroundColor: theme.colors.divider,
        },
        buttonText: {
            fontSize: 17,
            color: theme.colors.textLink,
        },
        buttonTextDisabled: {
            color: theme.colors.textSecondary,
            opacity: 0.6,
        },
    });

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={[styles.title, Typography.default('semiBold')]}>{title}</Text>

                <Text style={[styles.label, Typography.default()]}>{t('terminal.quickCommandsNamePrompt')}</Text>
                <TextInput
                    ref={nameRef}
                    style={[styles.input, styles.nameInput, Typography.default()]}
                    value={name}
                    onChangeText={setName}
                    placeholder={t('terminal.quickCommandsNamePlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => commandRef.current?.focus()}
                />

                <Text style={[styles.label, styles.labelSpaced, Typography.default()]}>{t('terminal.quickCommandsCommandPrompt')}</Text>
                <TextInput
                    ref={commandRef}
                    style={[styles.input, styles.commandInput]}
                    value={command}
                    onChangeText={setCommand}
                    placeholder="git status"
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    // Enter inserts a newline; Cmd/Ctrl+Enter saves.
                    onKeyPress={(e: any) => {
                        const key = e?.nativeEvent?.key;
                        const meta = e?.nativeEvent?.metaKey || e?.nativeEvent?.ctrlKey;
                        if (key === 'Enter' && meta) {
                            e.preventDefault?.();
                            handleSave();
                        }
                    }}
                />
            </ScrollView>

            <View style={styles.buttonContainer}>
                <Pressable
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                    onPress={() => complete(null)}
                >
                    <Text style={[styles.buttonText, Typography.default()]}>{t('common.cancel')}</Text>
                </Pressable>
                <View style={styles.buttonSeparator} />
                <Pressable
                    disabled={!canSave}
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                    onPress={handleSave}
                >
                    <Text style={[styles.buttonText, !canSave && styles.buttonTextDisabled, Typography.default('semiBold')]}>
                        {t('common.save')}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

// Opens the merged editor and resolves with the entered values, or null if the
// user cancels or dismisses the dialog.
export function editQuickCommand(opts: { title: string; initialName?: string; initialCommand?: string }): Promise<QuickCommandEditResult | null> {
    return new Promise((resolve) => {
        let id = '';
        let settled = false;
        const done = (result: QuickCommandEditResult | null) => {
            if (settled) return;
            settled = true;
            if (id) Modal.hide(id);
            resolve(result);
        };
        id = Modal.show({
            component: QuickCommandEditModal,
            props: { ...opts, onComplete: done },
        });
    });
}
