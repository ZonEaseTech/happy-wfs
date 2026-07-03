import React from 'react';
import { Pressable, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { bugStatusLabel, type BugReportSummary } from '@/sync/bugTypes';

export const BugReportItem = React.memo(({ bug, onPress }: {
    bug: BugReportSummary;
    onPress: (bug: BugReportSummary) => void;
}) => {
    const styles = stylesheet;
    return (
        <Pressable
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.78 }]}
            onPress={() => onPress(bug)}
        >
            <View style={styles.iconCircle}><Text style={styles.iconText}>🐞</Text></View>
            <View style={styles.content}>
                <Text style={styles.repo} numberOfLines={1}>Bug · {bug.displayId}</Text>
                <Text style={styles.title} numberOfLines={2}>{bug.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                    {t('bug.status')} {bugStatusLabel(bug.status)} · {bug.createdByNickname ?? t('bug.anonymousUser')} · {bug.attachmentCount} {t('bug.screenshots')} · {bug.commentCount} {t('bug.comment')}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={styles.repo.color} />
        </Pressable>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginHorizontal: 16,
        marginBottom: 10,
    },
    iconCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    iconText: { fontSize: 18 },
    content: { flex: 1, minWidth: 0 },
    repo: { fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() },
    title: { fontSize: 16, color: theme.colors.text, marginTop: 4, ...Typography.default('semiBold') },
    meta: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 6, ...Typography.default() },
}));
