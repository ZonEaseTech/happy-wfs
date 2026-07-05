import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ExpoImagePicker from 'expo-image-picker';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import type { LocalImage } from '@/components/ImagePreview';
import { BUG_IMAGE_LIMITS, type BugReportDetail } from '@/sync/bugTypes';
import { getBugRichPlainText, insertBugImageAtSelection, serializeBugRichContent, type BugEditorBlock, type BugTiptapDoc } from '@/sync/bugRichContent';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import { getBugCreateRemainingImageSlots, isBugCreateSubmitEnabled, shouldShowBugCreateEmptyHint } from './bugReportCreatePresentation';
import { BugTiptapEditor } from './BugTiptapEditor';
import type { BugTiptapEditorHandle, BugTiptapEditorSnapshot } from './BugTiptapEditor.types';

let bugEditorBlockId = 0;
function createBlockId(prefix: string): string {
    bugEditorBlockId += 1;
    return `${prefix}-${Date.now()}-${bugEditorBlockId}`;
}

async function localImageFromUri(uri: string, mimeType: string): Promise<LocalImage> {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.Image === 'function') {
        const image = new window.Image();
        image.src = uri;
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = reject;
        });
        return {
            uri,
            width: image.naturalWidth || 512,
            height: image.naturalHeight || 512,
            mimeType,
        };
    }
    return { uri, width: 512, height: 512, mimeType };
}

function countImageBlocks(blocks: BugEditorBlock<LocalImage>[]): number {
    return blocks.filter(block => block.type === 'image').length;
}

const emptyTiptapSnapshot: BugTiptapEditorSnapshot = {
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    plainText: '',
    imageCount: 0,
    description: '',
    images: [],
};

export function BugReportCreateModal({
    onClose,
    onCreate,
}: {
    onClose: () => void;
    onCreate: (description: string, images: LocalImage[], contentJson?: BugTiptapDoc) => Promise<BugReportDetail>;
}) {
    const styles = stylesheet;
    const { width, height } = useWindowDimensions();
    const isWide = width >= 760;
    const modalWidth = Math.min(isWide ? 940 : 720, Math.max(320, width - (isWide ? 72 : 28)));
    const modalMaxHeight = Math.min(isWide ? 800 : height - 28, Math.max(520, height - (isWide ? 72 : 28)));
    const firstTextBlockId = React.useRef(createBlockId('text'));
    const [blocks, setBlocks] = React.useState<BugEditorBlock<LocalImage>[]>(() => [{ id: firstTextBlockId.current, type: 'text', text: '' }]);
    const [tiptapSnapshot, setTiptapSnapshot] = React.useState<BugTiptapEditorSnapshot>(emptyTiptapSnapshot);
    const [submitting, setSubmitting] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const tiptapEditorRef = React.useRef<BugTiptapEditorHandle>(null);
    const textInputRefs = React.useRef<Record<string, React.ElementRef<typeof TextInput> | null>>({});
    const activeTextBlockIdRef = React.useRef(firstTextBlockId.current);
    const selectionRef = React.useRef<Record<string, { start: number; end: number }>>({
        [firstTextBlockId.current]: { start: 0, end: 0 },
    });

    const useTiptapEditor = Platform.OS === 'web';
    const nativeImageCount = countImageBlocks(blocks);
    const nativePlainText = getBugRichPlainText(blocks);
    const imageCount = useTiptapEditor ? tiptapSnapshot.imageCount : nativeImageCount;
    const plainText = useTiptapEditor ? tiptapSnapshot.plainText : nativePlainText;
    const canSubmit = isBugCreateSubmitEnabled(plainText, submitting);
    const remainingImageSlots = getBugCreateRemainingImageSlots(imageCount, BUG_IMAGE_LIMITS.maxImages);
    const showEmptyHint = shouldShowBugCreateEmptyHint(nativePlainText, nativeImageCount);

    const focusTextBlock = React.useCallback((id: string) => {
        activeTextBlockIdRef.current = id;
        setTimeout(() => textInputRefs.current[id]?.focus(), 0);
    }, []);

    const updateTextBlock = React.useCallback((id: string, text: string) => {
        setBlocks(current => current.map(block => block.id === id && block.type === 'text' ? { ...block, text } : block));
    }, []);

    const removeImageBlock = React.useCallback((id: string) => {
        setBlocks(current => current.filter(block => block.id !== id));
    }, []);

    const insertImageAtCursor = React.useCallback((image: LocalImage) => {
        const nextTextId = createBlockId('text');
        setBlocks((current) => {
            const fallbackText = [...current].reverse().find(block => block.type === 'text');
            const textBlockId = activeTextBlockIdRef.current || fallbackText?.id || firstTextBlockId.current;
            const textBlock = current.find(block => block.id === textBlockId && block.type === 'text');
            const fallbackCursor = textBlock && textBlock.type === 'text' ? textBlock.text.length : 0;
            const selection = selectionRef.current[textBlockId] ?? { start: fallbackCursor, end: fallbackCursor };
            activeTextBlockIdRef.current = nextTextId;
            selectionRef.current[nextTextId] = { start: 0, end: 0 };
            return insertBugImageAtSelection(current, {
                textBlockId,
                selectionStart: selection.start,
                selectionEnd: selection.end,
                image,
                createTextId: () => nextTextId,
                createImageId: () => createBlockId('image'),
            });
        });
        focusTextBlock(nextTextId);
    }, [focusTextBlock]);

    const addImageFromUri = React.useCallback(async (uri: string, mimeType: string) => {
        if (countImageBlocks(blocks) >= BUG_IMAGE_LIMITS.maxImages) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return;
        }
        const image = await localImageFromUri(uri, mimeType || 'image/jpeg');
        insertImageAtCursor(image);
    }, [blocks, insertImageAtCursor]);

    const addImageFile = React.useCallback(async (file: File, mimeType?: string) => {
        if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
            Modal.alert(t('common.error'), t('bug.imageTooLarge'));
            return;
        }
        const url = URL.createObjectURL(file);
        await addImageFromUri(url, mimeType || file.type || 'image/jpeg');
    }, [addImageFromUri]);

    const addImageFiles = React.useCallback((files: FileList | File[]) => {
        const remaining = getBugCreateRemainingImageSlots(countImageBlocks(blocks), BUG_IMAGE_LIMITS.maxImages);
        if (remaining <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return;
        }
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        const selectedFiles = imageFiles.slice(0, remaining);
        if (imageFiles.length > remaining) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
        }
        selectedFiles.forEach(file => { void addImageFile(file); });
    }, [addImageFile, blocks]);

    const addTiptapImageFiles = React.useCallback((files: FileList | File[]) => {
        const remaining = getBugCreateRemainingImageSlots(tiptapSnapshot.imageCount, BUG_IMAGE_LIMITS.maxImages);
        if (remaining <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return;
        }
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        const selectedFiles = imageFiles.slice(0, remaining);
        if (imageFiles.length > remaining) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
        }
        selectedFiles.forEach(file => {
            if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
                Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                return;
            }
            const url = URL.createObjectURL(file);
            void localImageFromUri(url, file.type || 'image/jpeg').then(image => {
                tiptapEditorRef.current?.insertImages([image]);
            });
        });
    }, [tiptapSnapshot.imageCount]);

    const handleSubmit = React.useCallback(async () => {
        const tiptapCurrentSnapshot = useTiptapEditor ? (tiptapEditorRef.current?.getSnapshot() ?? tiptapSnapshot) : null;
        const serialized = tiptapCurrentSnapshot ?? serializeBugRichContent(blocks);
        const currentPlainText = tiptapCurrentSnapshot?.plainText ?? getBugRichPlainText(blocks);
        if (!isBugCreateSubmitEnabled(currentPlainText, submitting)) {
            Modal.alert(t('common.error'), t('bug.contentRequiredHint'));
            return;
        }
        setSubmitting(true);
        try {
            await onCreate(serialized.description, serialized.images, tiptapCurrentSnapshot?.contentJson);
            onClose();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setSubmitting(false);
        }
    }, [blocks, onClose, onCreate, submitting, tiptapSnapshot, useTiptapEditor]);

    const handleUploadPress = React.useCallback(async () => {
        if (remainingImageSlots <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return;
        }
        if (Platform.OS === 'web') {
            fileInputRef.current?.click();
            return;
        }
        const permission = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;
        const result = await ExpoImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: remainingImageSlots,
            quality: 0.9,
        });
        if (result.canceled) return;
        for (const asset of result.assets.slice(0, remainingImageSlots)) {
            if (asset.fileSize != null && asset.fileSize > BUG_IMAGE_LIMITS.maxSizeBytes) {
                Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                continue;
            }
            insertImageAtCursor({
                uri: asset.uri,
                width: asset.width || 512,
                height: asset.height || 512,
                mimeType: asset.mimeType || 'image/jpeg',
            });
        }
    }, [insertImageAtCursor, remainingImageSlots]);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        if (useTiptapEditor) {
            addTiptapImageFiles(files);
        } else {
            addImageFiles(files);
        }
        event.target.value = '';
    }, [addImageFiles, addTiptapImageFiles, useTiptapEditor]);

    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: countImageBlocks(blocks) < BUG_IMAGE_LIMITS.maxImages,
            supportsImages: true,
            onImageFile: async (file, mimeType) => {
                await addImageFile(file, mimeType);
            },
        });
    }, [addImageFile, blocks]);

    const paperWebDropProps = React.useMemo(() => {
        if (Platform.OS !== 'web') return {};
        return {
            onDragOver: (event: React.DragEvent) => {
                event.preventDefault();
            },
            onDrop: (event: React.DragEvent) => {
                event.preventDefault();
                if (event.dataTransfer.files.length > 0) {
                    addImageFiles(event.dataTransfer.files);
                }
            },
        };
    }, [addImageFiles]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || useTiptapEditor) return;
        const pasteListener = (event: Event) => { void handlePaste(event as ClipboardEvent); };
        document.addEventListener('paste', pasteListener);
        return () => document.removeEventListener('paste', pasteListener);
    }, [handlePaste, useTiptapEditor]);

    return (
        <View style={[styles.modal, { width: modalWidth, height: modalMaxHeight, maxHeight: modalMaxHeight }, !isWide && styles.modalCompact]}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <View style={styles.titleRow}>
                        <Text style={styles.title}>{t('bug.newBug')}</Text>
                        <Text style={styles.statusTag}>{t('bug.statusPending')}</Text>
                    </View>
                    <Text style={styles.subtitle}>{t('bug.noteStyleSubtitle')}</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
                    <Ionicons name="close" size={22} color={styles.title.color} />
                </Pressable>
            </View>

            <View style={styles.body}>
                {useTiptapEditor ? (
                    <View style={[styles.paper, { overflowY: 'auto' } as any]}>
                        <View style={styles.paperContent}>
                            <BugTiptapEditor ref={tiptapEditorRef} onChange={setTiptapSnapshot} />
                        </View>
                    </View>
                ) : (
                    <ScrollView {...paperWebDropProps} style={styles.paper} contentContainerStyle={styles.paperContent} keyboardShouldPersistTaps="handled">
                        {blocks.map((block, index) => {
                            if (block.type === 'image') {
                                return (
                                    <View key={block.id} style={styles.noteImageWrap}>
                                        <Image source={{ uri: block.image.uri }} style={styles.noteImage} contentFit="cover" />
                                        <Pressable style={styles.removeImageButton} onPress={() => removeImageBlock(block.id)} hitSlop={8}>
                                            <Ionicons name="close" size={16} color="#fff" />
                                        </Pressable>
                                    </View>
                                );
                            }
                            return (
                                <TextInput
                                    key={block.id}
                                    ref={(node) => { textInputRefs.current[block.id] = node; }}
                                    style={[
                                        styles.noteTextInput,
                                        index === 0 && showEmptyHint && styles.emptyNoteTextInput,
                                        Platform.OS === 'web' && {
                                            outlineStyle: 'none',
                                            outline: 'none',
                                            outlineWidth: 0,
                                            outlineColor: 'transparent',
                                            boxShadow: 'none',
                                            resize: 'none',
                                            borderWidth: 0,
                                        } as any,
                                    ]}
                                    value={block.text}
                                    onFocus={() => { activeTextBlockIdRef.current = block.id; }}
                                    onChangeText={(value) => updateTextBlock(block.id, value)}
                                    onSelectionChange={(event) => {
                                        const selection = event.nativeEvent.selection;
                                        selectionRef.current[block.id] = { start: selection.start, end: selection.end };
                                    }}
                                    placeholder={index === 0 && showEmptyHint ? t('bug.noteStylePlaceholder') : ''}
                                    placeholderTextColor={styles.placeholder.color}
                                    multiline
                                    textAlignVertical="top"
                                />
                            );
                        })}
                    </ScrollView>
                )}
                {Platform.OS === 'web' && <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />}
            </View>

            <View style={[styles.footer, !isWide && styles.footerCompact]}>
                <View style={styles.footerLeft}>
                    <Pressable style={styles.imageButton} onPress={() => { void handleUploadPress(); }} disabled={remainingImageSlots <= 0 || submitting}>
                        <Ionicons name="image-outline" size={19} color={styles.imageButtonIcon.color} />
                    </Pressable>
                    <Text style={styles.footerHint}>{t('bug.noteStyleFooterHint')}</Text>
                </View>
                <View style={styles.footerActions}>
                    <Pressable style={styles.cancelButton} disabled={submitting} onPress={onClose}>
                        <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]} disabled={!canSubmit} onPress={() => { void handleSubmit(); }}>
                        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t('bug.submit')}</Text>}
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: {
        backgroundColor: '#FDFBF7',
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E6E1D8',
    },
    modalCompact: {
        borderRadius: 22,
    },
    header: {
        minHeight: 94,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 32,
        paddingVertical: 24,
        borderBottomWidth: 1,
        borderBottomColor: '#E8E1D4',
        backgroundColor: '#F8F5EE',
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    title: {
        color: theme.colors.text,
        fontSize: 30,
        ...Typography.default('semiBold'),
    },
    statusTag: {
        color: '#854D0E',
        backgroundColor: '#FFF2C7',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        overflow: 'hidden',
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
        ...Typography.default(),
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    body: {
        flex: 1,
        minHeight: 0,
        paddingHorizontal: 32,
        paddingTop: 24,
        paddingBottom: 16,
        backgroundColor: '#FDFBF7',
    },
    paper: {
        flex: 1,
        minHeight: 0,
        borderWidth: 1,
        borderColor: '#E6E1D8',
        borderRadius: 22,
        backgroundColor: '#FFFEFB',
    },
    paperContent: {
        paddingHorizontal: 26,
        paddingVertical: 24,
        gap: 14,
    },
    noteTextInput: {
        minHeight: 32,
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 29,
        padding: 0,
        borderWidth: 0,
        backgroundColor: 'transparent',
        ...Typography.default(),
    },
    emptyNoteTextInput: {
        minHeight: 260,
    },
    placeholder: {
        color: '#8A8173',
    },
    noteImageWrap: {
        position: 'relative',
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#F1ECE2',
    },
    noteImage: {
        width: '100%',
        height: 240,
        backgroundColor: '#F1ECE2',
    },
    removeImageButton: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(0,0,0,0.72)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    footer: {
        minHeight: 74,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: '#E8E1D4',
        backgroundColor: '#F8F5EE',
    },
    footerCompact: {
        alignItems: 'stretch',
        flexDirection: 'column',
    },
    footerLeft: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    imageButton: {
        width: 38,
        height: 38,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#E6E1D8',
        backgroundColor: '#FFFEFB',
    },
    imageButtonIcon: {
        color: theme.colors.text,
    },
    footerHint: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
    footerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
    },
    cancelButton: {
        borderRadius: 15,
        paddingHorizontal: 22,
        paddingVertical: 14,
        backgroundColor: '#EEE9DF',
    },
    cancelButtonText: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    primaryButton: {
        minWidth: 148,
        minHeight: 48,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingVertical: 14,
        backgroundColor: theme.colors.button.primary.background,
    },
    primaryButtonDisabled: {
        opacity: 0.45,
    },
    primaryButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 16,
        ...Typography.default('semiBold'),
    },
}));
