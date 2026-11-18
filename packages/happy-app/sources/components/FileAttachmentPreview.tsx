import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { ImagePreview, type LocalImage } from '@/components/ImagePreview';
import { Typography } from '@/constants/Typography';
import { formatFileSize, isPreviewableImageAttachment, type LocalFileAttachment } from '@/utils/fileAttachments';

// On native the picked file is an expo-file-system File, which already has a uri.
function nativeFileUri(file: LocalFileAttachment): string | undefined {
    const uri = (file.blob as { uri?: unknown }).uri;
    return typeof uri === 'string' ? uri : undefined;
}

// On web each image needs an object URL, released once it leaves the list.
function useWebObjectUrls(files: LocalFileAttachment[]): Record<string, string> {
    const [urls, setUrls] = React.useState<Record<string, string>>({});
    const owned = React.useRef(new Map<string, string>());

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const currentIds = new Set(files.map(file => file.id));
        for (const [id, url] of owned.current) {
            if (!currentIds.has(id)) {
                URL.revokeObjectURL(url);
                owned.current.delete(id);
            }
        }
        for (const file of files) {
            if (!owned.current.has(file.id)) {
                owned.current.set(file.id, URL.createObjectURL(file.blob));
            }
        }
        setUrls(Object.fromEntries(owned.current));
    }, [files]);

    React.useEffect(() => () => {
        for (const url of owned.current.values()) URL.revokeObjectURL(url);
        owned.current.clear();
    }, []);

    return urls;
}

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
    const imageFiles = React.useMemo(() => attachments.filter(file => (
        isPreviewableImageAttachment(file) && (Platform.OS === 'web' || nativeFileUri(file) !== undefined)
    )), [attachments]);
    const webUrls = useWebObjectUrls(imageFiles);
    const thumbnails = React.useMemo(() => imageFiles.flatMap((file) => {
        const uri = Platform.OS === 'web' ? webUrls[file.id] : nativeFileUri(file);
        if (!uri) return [];
        const image: LocalImage = { uri, width: 0, height: 0, mimeType: file.mimeType ?? '' };
        return [{ id: file.id, image }];
    }), [imageFiles, webUrls]);
    const thumbnailImages = React.useMemo(() => thumbnails.map(item => item.image), [thumbnails]);

    if (attachments.length === 0) return null;

    const imageIds = new Set(imageFiles.map(file => file.id));
    const hasFileRows = attachments.some(file => !imageIds.has(file.id));

    return (
        <>
            <ImagePreview
                images={thumbnailImages}
                maxImages={thumbnailImages.length}
                disabled={disabled}
                onRemove={(thumbnailIndex) => {
                    const id = thumbnails[thumbnailIndex]?.id;
                    const index = attachments.findIndex(file => file.id === id);
                    if (index >= 0) onRemove(index);
                }}
            />
            {hasFileRows && <View style={{ paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
            {attachments.map((file, index) => imageIds.has(file.id) ? null : (
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
            </View>}
        </>
    );
}
