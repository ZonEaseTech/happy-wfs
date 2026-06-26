import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { formatFileSize, type LocalFileAttachment } from '@/utils/fileAttachments';


export function FileAttachmentPreview({
    attachments,
    disabled,
    onRemove,
}: {
    attachments: LocalFileAttachment[];
    disabled?: boolean;
    onRemove: (index: number) => void;
}) {
    const { theme } = useUnistyles();
    if (attachments.length === 0) return null;

    return (
        <View style={{ paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
            {attachments.map((file, index) => (
                <View
                    key={file.id}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                        borderRadius: 12,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                    }}
                >
                    <Ionicons name="document-outline" size={20} color={theme.colors.textSecondary} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 14,
                                fontWeight: '600',
                                color: theme.colors.text,
                                ...Typography.default('semiBold'),
                            }}
                        >
                            {file.name}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 12,
                                color: theme.colors.textSecondary,
                                ...Typography.default('regular'),
                            }}
                        >
                            {formatFileSize(file.size)}{file.mimeType ? ` · ${file.mimeType}` : ''}
                        </Text>
                    </View>
                    <Pressable
                        disabled={disabled}
                        onPress={() => onRemove(index)}
                        hitSlop={10}
                        style={{ opacity: disabled ? 0.4 : 1, padding: 4 }}
                    >
                        <Ionicons name="close-circle" size={20} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            ))}
        </View>
    );
}
