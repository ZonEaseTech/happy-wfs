import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandSuggestionProps {
    command: string;
    description?: string;
    prefix?: '/' | '$';
}

export const CommandSuggestion = React.memo(({ command, description, prefix = '/' }: CommandSuggestionProps) => {
    return (
        <View style={styles.suggestionContainer}>
            <Text 
                style={[styles.commandText, { marginRight: description ? 12 : 0 }]}
            >
                {prefix}{command}
            </Text>
            {description && (
                <Text
                    style={styles.descriptionText}
                    numberOfLines={1}
                >
                    {description}
                </Text>
            )}
        </View>
    );
});

interface FileMentionProps {
    fileName: string;
    filePath: string;
    fileType?: 'file' | 'folder';
}

export const FileMentionSuggestion = React.memo(({ fileName, filePath, fileType = 'file' }: FileMentionProps) => {
    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name={fileType === 'folder' ? 'folder' : 'document-text'}
                    size={18}
                    color={styles.iconColor.color}
                />
            </View>
            <Text 
                style={styles.fileNameText}
                numberOfLines={1}
            >
                {filePath}{fileName}
            </Text>
            <Text style={styles.labelText}>
                {fileType === 'folder' ? t('agentInput.suggestion.folderLabel') : t('agentInput.suggestion.fileLabel')}
            </Text>
        </View>
    );
});

interface FriendMentionProps {
    username: string;
    displayName: string;
}

function PersonMentionSuggestion({ username, displayName, label }: FriendMentionProps & { label: string }) {
    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name="person-circle"
                    size={20}
                    color={styles.iconColor.color}
                />
            </View>
            <View style={styles.friendTextContainer}>
                <Text
                    style={styles.friendDisplayNameText}
                    numberOfLines={1}
                >
                    {displayName}
                </Text>
                <Text
                    style={styles.friendUsernameText}
                    numberOfLines={1}
                >
                    @{username}
                </Text>
            </View>
            <Text style={styles.labelText}>
                {label}
            </Text>
        </View>
    );
}

export const FriendMentionSuggestion = React.memo((props: FriendMentionProps) => (
    <PersonMentionSuggestion {...props} label={t('agentInput.suggestion.friendLabel')} />
));

export const CoworkerMentionSuggestion = React.memo((props: FriendMentionProps) => (
    <PersonMentionSuggestion {...props} label={t('agentInput.suggestion.coworkerLabel')} />
));

const styles = StyleSheet.create((theme) => ({
    suggestionContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        height: 48,
    },
    commandText: {
        fontSize: 14,
        color: theme.colors.text,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    descriptionText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    iconColor: {
        color: theme.colors.textSecondary,
    },
    fileNameText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    friendTextContainer: {
        flex: 1,
        minWidth: 0,
    },
    friendDisplayNameText: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    friendUsernameText: {
        marginTop: 2,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    labelText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginLeft: 8,
        ...Typography.default(),
    },
}));
