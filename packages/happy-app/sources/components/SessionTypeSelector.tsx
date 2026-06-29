import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface SessionTypeSelectorProps {
    value: 'simple' | 'worktree';
    onChange: (value: 'simple' | 'worktree') => void;
    worktreeAccessory?: React.ReactNode;
}

const stylesheet = StyleSheet.create((theme, rt) => ({
    container: {
        flexDirection: 'row',
        borderRadius: 10,
        overflow: 'hidden',
        padding: 2,
        backgroundColor: rt.themeName === 'dark' ? theme.colors.surfaceHighest : theme.colors.input.background,
    },
    option: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 8,
    },
    optionActive: {
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    label: {
        fontSize: 14,
    },
    labelActive: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    labelInactive: {
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    optionContent: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    worktreeAccessory: {
        position: 'absolute',
        right: 8,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
    },
}));

const SESSION_TYPES = ['simple', 'worktree'] as const;

export const SessionTypeSelector: React.FC<SessionTypeSelectorProps> = ({ value, onChange, worktreeAccessory }) => {
    const styles = stylesheet;

    return (
        <View style={styles.container}>
            {SESSION_TYPES.map((type) => {
                const isActive = value === type;
                return (
                    <Pressable
                        key={type}
                        onPress={() => onChange(type)}
                        style={[styles.option, isActive && styles.optionActive]}
                    >
                        <View style={styles.optionContent}>
                            <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                                {t(`newSession.sessionType.${type}`)}
                            </Text>
                            {type === 'worktree' && worktreeAccessory ? (
                                <View style={styles.worktreeAccessory}>
                                    {worktreeAccessory}
                                </View>
                            ) : null}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
};
