import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardTypeOptions, Platform, useWindowDimensions } from 'react-native';
import { BaseModal } from './BaseModal';
import { PromptModalConfig } from '../types';
import { Modal } from '../ModalManager';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface WebPromptModalProps {
    config: PromptModalConfig;
    onClose: () => void;
    onConfirm: (value: string | null) => void;
}

export function WebPromptModal({ config, onClose, onConfirm }: WebPromptModalProps) {
    const { theme } = useUnistyles();
    const window = useWindowDimensions();
    const [inputValue, setInputValue] = useState(config.defaultValue || '');
    const [checkboxChecked, setCheckboxChecked] = useState(config.checkbox?.defaultValue ?? false);
    const inputRef = useRef<TextInput>(null);
    const isLargePrompt = config.size === 'large' || (config.multiline && (config.multilineRows ?? 6) >= 12);
    const visibleMultilineRows = config.multiline ? Math.min(config.multilineRows ?? 6, isLargePrompt ? 12 : 8) : 1;
    const modalMaxHeight = Math.max(260, Math.floor(window.height * 0.82));
    const modalWidth = Math.min(isLargePrompt ? 560 : 270, Math.max(240, Math.floor(window.width * 0.92)));
    const buttonHeight = 52;
    const contentMaxHeight = Math.max(160, modalMaxHeight - buttonHeight);

    useEffect(() => {
        // Auto-focus the input when modal opens
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        Modal.setCheckboxState(config.id, checkboxChecked);
    }, [checkboxChecked, config.id]);

    const handleCancel = () => {
        onConfirm(null);
        onClose();
    };

    const handleConfirm = () => {
        onConfirm(inputValue);
        onClose();
    };

    const getKeyboardType = (): KeyboardTypeOptions => {
        switch (config.inputType) {
            case 'email-address':
                return 'email-address';
            case 'numeric':
                return 'numeric';
            default:
                return 'default';
        }
    };

    const styles = StyleSheet.create({
        container: {
            backgroundColor: theme.colors.surface,
            borderRadius: 14,
            width: modalWidth,
            maxHeight: modalMaxHeight,
            overflow: 'hidden',
            shadowColor: theme.colors.shadow.color,
            shadowOffset: {
                width: 0,
                height: 2
            },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5
        },
        content: {
            paddingHorizontal: isLargePrompt ? 24 : 16,
            paddingTop: 16,
            paddingBottom: 12,
            alignItems: 'center',
            flexShrink: 1,
            maxHeight: contentMaxHeight,
            overflow: 'hidden'
        },
        title: {
            fontSize: 17,
            textAlign: 'center',
            color: theme.colors.text,
            marginBottom: 4
        },
        message: {
            fontSize: 13,
            textAlign: 'center',
            color: theme.colors.text,
            marginTop: 4,
            lineHeight: 18
        },
        input: {
            width: '100%',
            height: 36,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            borderRadius: 8,
            paddingHorizontal: 10,
            marginTop: 16,
            fontSize: 14,
            color: theme.colors.text,
            backgroundColor: theme.colors.input.background
        },
        buttonContainer: {
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            flexDirection: 'row',
            flexShrink: 0,
            minHeight: buttonHeight
        },
        button: {
            flex: 1,
            minHeight: buttonHeight,
            alignItems: 'center',
            justifyContent: 'center'
        },
        buttonPressed: {
            backgroundColor: theme.colors.divider
        },
        buttonSeparator: {
            width: 1,
            backgroundColor: theme.colors.divider
        },
        buttonText: {
            fontSize: 17,
            color: theme.colors.textLink
        },
        cancelText: {
            fontWeight: '400'
        }
    });

    return (
        <BaseModal visible={true} onClose={handleCancel} closeOnBackdrop={false}>
            <View style={styles.container}>
                <View style={styles.content}>
                    <Text style={[styles.title, Typography.default('semiBold')]}>
                        {config.title}
                    </Text>
                    {config.message && (
                        <Text style={[styles.message, Typography.default()]}>
                            {config.message}
                        </Text>
                    )}
                    <TextInput
                        ref={inputRef}
                        style={[
                            styles.input,
                            Typography.default(),
                            config.multiline && {
                                height: 24 * visibleMultilineRows,
                                minHeight: 24 * visibleMultilineRows,
                                maxHeight: isLargePrompt ? 420 : undefined,
                                flexShrink: 1,
                                textAlignVertical: 'top' as const,
                                paddingTop: 12,
                            },
                        ]}
                        value={inputValue}
                        onChangeText={setInputValue}
                        placeholder={config.placeholder}
                        placeholderTextColor={theme.colors.input.placeholder}
                        keyboardType={getKeyboardType()}
                        secureTextEntry={config.inputType === 'secure-text'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus={Platform.OS === 'web'}
                        // Single-line: Enter submits. Multi-line: Enter inserts a
                        // newline (handled by the input itself), Cmd/Ctrl+Enter
                        // submits via onKeyPress below.
                        multiline={config.multiline ?? false}
                        numberOfLines={config.multiline ? (config.multilineRows ?? 6) : 1}
                        blurOnSubmit={!config.multiline}
                        onSubmitEditing={config.multiline ? undefined : handleConfirm}
                        onKeyPress={config.multiline ? (e: any) => {
                            const key = e?.nativeEvent?.key;
                            const meta = e?.nativeEvent?.metaKey || e?.nativeEvent?.ctrlKey;
                            if (key === 'Enter' && meta) {
                                e.preventDefault?.();
                                handleConfirm();
                            }
                        } : undefined}
                        returnKeyType={config.multiline ? 'default' : 'done'}
                    />
                    {config.checkbox && (
                        <Pressable
                            onPress={() => setCheckboxChecked(v => !v)}
                            style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, alignSelf: 'flex-start', paddingVertical: 2 }}
                        >
                            <Ionicons
                                name={checkboxChecked ? 'checkbox' : 'square-outline'}
                                size={18}
                                color={checkboxChecked ? theme.colors.textLink : theme.colors.textSecondary}
                            />
                            <Text style={[{ fontSize: 12, color: theme.colors.textSecondary, marginLeft: 6, flex: 1 }, Typography.default()]}>
                                {config.checkbox.label}
                            </Text>
                        </Pressable>
                    )}
                </View>
                
                <View style={styles.buttonContainer}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.button,
                            pressed && styles.buttonPressed
                        ]}
                        onPress={handleCancel}
                    >
                        <Text style={[
                            styles.buttonText,
                            styles.cancelText,
                            Typography.default()
                        ]}>
                            {config.cancelText || t('common.cancel')}
                        </Text>
                    </Pressable>
                    <View style={styles.buttonSeparator} />
                    <Pressable
                        style={({ pressed }) => [
                            styles.button,
                            pressed && styles.buttonPressed
                        ]}
                        onPress={handleConfirm}
                    >
                        <Text style={[
                            styles.buttonText,
                            Typography.default('semiBold')
                        ]}>
                            {config.confirmText || t('common.ok')}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </BaseModal>
    );
}
