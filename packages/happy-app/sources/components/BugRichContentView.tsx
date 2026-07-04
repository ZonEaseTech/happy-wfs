import React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { BugAttachment } from '@/sync/bugTypes';
import { parseBugRichContent } from '@/sync/bugRichContent';

export function BugRichContentView({
    description,
    attachments,
    emptyText = '-',
    compact = false,
}: {
    description: string;
    attachments: BugAttachment[];
    emptyText?: string;
    compact?: boolean;
}) {
    const styles = stylesheet;
    const blocks = React.useMemo(() => parseBugRichContent(description, attachments), [attachments, description]);

    if (blocks.length === 0) {
        return <Text style={styles.muted}>{emptyText}</Text>;
    }

    return (
        <View style={[styles.container, compact && styles.containerCompact]}>
            {blocks.map((block, index) => {
                if (block.type === 'text') {
                    return <Text key={`text-${index}`} style={[styles.textBlock, compact && styles.textBlockCompact]} selectable>{block.text}</Text>;
                }
                return (
                    <Image
                        key={`image-${block.attachment.id}-${index}`}
                        source={{ uri: block.attachment.url }}
                        style={[styles.imageBlock, compact && styles.imageBlockCompact]}
                        contentFit="cover"
                    />
                );
            })}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        gap: 14,
    },
    containerCompact: {
        gap: 10,
    },
    textBlock: {
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 26,
        ...Typography.default(),
    },
    textBlockCompact: {
        fontSize: 14,
        lineHeight: 22,
    },
    imageBlock: {
        width: '100%',
        height: 240,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceHigh,
    },
    imageBlockCompact: {
        height: 170,
        borderRadius: 12,
    },
    muted: {
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
