import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { BugAttachment } from '@/sync/bugTypes';
import { bugTiptapDocToRichContent, parseBugRichContent, type BugTiptapDoc } from '@/sync/bugRichContent';

export function BugRichContentView({
    description,
    contentJson,
    attachments,
    emptyText = '-',
    compact = false,
    noteStyle = false,
    onImagePress,
}: {
    description: string;
    contentJson?: BugTiptapDoc | null;
    attachments: BugAttachment[];
    emptyText?: string;
    compact?: boolean;
    noteStyle?: boolean;
    onImagePress?: (attachment: BugAttachment) => void;
}) {
    const styles = stylesheet;
    const blocks = React.useMemo(
        () => contentJson?.content?.length ? bugTiptapDocToRichContent(contentJson, attachments) : parseBugRichContent(description, attachments),
        [attachments, contentJson, description],
    );

    if (blocks.length === 0) {
        return <Text style={styles.muted}>{emptyText}</Text>;
    }

    return (
        <View style={[styles.container, compact && styles.containerCompact, noteStyle && styles.containerNote]}>
            {blocks.map((block, index) => {
                if (block.type === 'text') {
                    return <Text key={`text-${index}`} style={[styles.textBlock, compact && styles.textBlockCompact, noteStyle && styles.textBlockNote]} selectable>{block.text}</Text>;
                }
                const image = (
                    <Image
                        key={`image-${block.attachment.id}-${index}`}
                        source={{ uri: block.attachment.url }}
                        style={[styles.imageBlock, compact && styles.imageBlockCompact, noteStyle && styles.imageBlockNote]}
                        contentFit="cover"
                    />
                );
                if (!onImagePress) return image;
                return (
                    <Pressable key={`image-press-${block.attachment.id}-${index}`} onPress={() => onImagePress(block.attachment)}>
                        {image}
                    </Pressable>
                );
            })}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        gap: 8,
    },
    containerCompact: {
        gap: 6,
    },
    containerNote: {
        gap: 8,
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
    textBlockNote: {
        fontSize: 18,
        lineHeight: 29,
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
    imageBlockNote: {
        height: 240,
        borderRadius: 16,
        backgroundColor: '#F1ECE2',
    },
    muted: {
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
