import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import { ImagePreview, type LocalImage } from '@/components/ImagePreview';
import { useImagePicker } from '@/hooks/useImagePicker';
import { BUG_IMAGE_LIMITS, bugStatusLabel, type BugReportDetail } from '@/sync/bugTypes';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import {
    getBugCreateImageCountLabel,
    getBugCreatePreviewTitle,
    getBugCreateRemainingImageSlots,
    isBugCreateSubmitEnabled,
} from './bugReportCreatePresentation';

const PENDING_STATUS_COLOR = '#F59E0B';

export function BugReportCreateModal({
    onClose,
    onCreate,
}: {
    onClose: () => void;
    onCreate: (description: string, images: LocalImage[]) => Promise<BugReportDetail>;
}) {
    const styles = stylesheet;
    const { width, height } = useWindowDimensions();
    const isWide = width >= 900;
    const modalWidth = Math.min(isWide ? 1120 : 720, Math.max(320, width - (isWide ? 72 : 28)));
    const modalMaxHeight = Math.min(isWide ? 800 : height - 28, Math.max(460, height - (isWide ? 72 : 28)));
    const [description, setDescription] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const picker = useImagePicker({ maxImages: BUG_IMAGE_LIMITS.maxImages, maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes });
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const canSubmit = isBugCreateSubmitEnabled(description, submitting);
    const previewTitle = getBugCreatePreviewTitle(description, t('bug.previewTitlePlaceholder'));
    const imageCountLabel = getBugCreateImageCountLabel(picker.images.length, BUG_IMAGE_LIMITS.maxImages);
    const remainingImageSlots = getBugCreateRemainingImageSlots(picker.images.length, BUG_IMAGE_LIMITS.maxImages);

    const handleSubmit = React.useCallback(async () => {
        const trimmed = description.trim();
        if (!isBugCreateSubmitEnabled(trimmed, submitting)) {
            Modal.alert(t('common.error'), t('bug.contentRequiredHint'));
            return;
        }
        setSubmitting(true);
        try {
            await onCreate(trimmed, picker.images);
            onClose();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setSubmitting(false);
        }
    }, [description, onClose, onCreate, picker.images, submitting]);

    const handleUploadPress = React.useCallback(() => {
        if (remainingImageSlots <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            return;
        }
        if (Platform.OS === 'web') {
            fileInputRef.current?.click();
            return;
        }
        void picker.pickFromGallery();
    }, [picker, remainingImageSlots]);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        const remaining = getBugCreateRemainingImageSlots(picker.images.length, BUG_IMAGE_LIMITS.maxImages);
        if (remaining <= 0) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
            event.target.value = '';
            return;
        }
        const selectedFiles = Array.from(files).slice(0, remaining);
        if (files.length > remaining) {
            Modal.alert(t('common.error'), t('bug.imageLimitReached', { max: BUG_IMAGE_LIMITS.maxImages }));
        }
        selectedFiles.forEach(file => {
            if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
                Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                return;
            }
            const url = URL.createObjectURL(file);
            void picker.addImageFromUri(url, file.type || 'image/jpeg');
        });
        event.target.value = '';
    }, [picker]);

    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleImagePasteEvent(event, {
            isScreenFocused: true,
            canAddMore: picker.canAddMore,
            supportsImages: true,
            onImageFile: async (file, mimeType) => {
                if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
                    Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                    return;
                }
                const url = URL.createObjectURL(file);
                await picker.addImageFromUri(url, mimeType);
            },
        });
    }, [picker]);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const pasteListener = (event: Event) => { void handlePaste(event as ClipboardEvent); };
        document.addEventListener('paste', pasteListener);
        return () => document.removeEventListener('paste', pasteListener);
    }, [handlePaste]);

    const footer = (
        <View style={[styles.footer, !isWide && styles.footerCompact]}>
            <Text style={styles.footerHint} numberOfLines={isWide ? 2 : 3}>{t('bug.submitSuccessHint')}</Text>
            <View style={[styles.footerActions, !isWide && styles.footerActionsCompact]}>
                <Pressable style={styles.cancelButton} disabled={submitting} onPress={onClose}>
                    <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                    style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
                    disabled={!canSubmit}
                    onPress={() => { void handleSubmit(); }}
                >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t('bug.submit')}</Text>}
                </Pressable>
            </View>
        </View>
    );

    return (
        <View style={[styles.modal, { width: modalWidth, height: modalMaxHeight, maxHeight: modalMaxHeight }, !isWide && styles.modalCompact]}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={styles.title}>{t('bug.newBug')}</Text>
                    <Text style={styles.subtitle}>{t('bug.createSubtitle')}</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={onClose} hitSlop={10}>
                    <Ionicons name="close" size={22} color={styles.title.color} />
                </Pressable>
            </View>

            <View style={[styles.body, !isWide && styles.bodyCompact]}>
                <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent} keyboardShouldPersistTaps="handled">
                    <View style={styles.fieldHeader}>
                        <Text style={styles.label}>{t('bug.content')} <Text style={styles.requiredMark}>*</Text></Text>
                        <Text style={styles.imageCount}>{t('bug.imageCounter', { count: picker.images.length, max: BUG_IMAGE_LIMITS.maxImages })}</Text>
                    </View>
                    <View style={styles.composer}>
                        <TextInput
                            style={styles.input}
                            value={description}
                            onChangeText={setDescription}
                            placeholder={t('bug.createPlaceholderDetailed')}
                            placeholderTextColor={styles.placeholder.color}
                            multiline
                            textAlignVertical="top"
                        />
                        <Pressable style={styles.dropZone} onPress={handleUploadPress}>
                            <View style={styles.dropHeader}>
                                <View style={styles.dropHeaderText}>
                                    <Text style={styles.dropTitle}>{t('bug.imageDropTitle')}</Text>
                                    <Text style={styles.dropHint}>{t('bug.imageDropHint')}</Text>
                                </View>
                                {Platform.OS === 'web' && <Text style={styles.shortcut}>{t('bug.pasteShortcut')}</Text>}
                            </View>
                            {picker.images.length > 0 ? (
                                <ImagePreview images={picker.images} onRemove={picker.removeImage} maxImages={BUG_IMAGE_LIMITS.maxImages} />
                            ) : (
                                <View style={styles.emptyImageRow}>
                                    <Ionicons name="image-outline" size={20} color={styles.emptyImageText.color} />
                                    <Text style={styles.emptyImageText}>{t('bug.clickToUpload')}</Text>
                                </View>
                            )}
                            <View style={styles.helperChips}>
                                <Text style={styles.helperChip}>{t('bug.autoTitleHint')}</Text>
                                <Text style={styles.helperChip}>{t('bug.defaultStatusHint')}</Text>
                                <Text style={styles.helperChip}>{t('bug.sortHint')}</Text>
                            </View>
                        </Pressable>
                    </View>
                    {!isWide && (
                        <View style={styles.mobilePreview}>
                            <PreviewPanel previewTitle={previewTitle} imageCountLabel={imageCountLabel} />
                        </View>
                    )}
                    {Platform.OS === 'web' && <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />}
                </ScrollView>

                {isWide && (
                    <View style={styles.sidePanel}>
                        <PreviewPanel previewTitle={previewTitle} imageCountLabel={imageCountLabel} />
                    </View>
                )}
            </View>
            {footer}
        </View>
    );
}

function PreviewPanel({ previewTitle, imageCountLabel }: { previewTitle: string; imageCountLabel: string }) {
    const styles = stylesheet;
    return (
        <>
            <Text style={styles.sideTitle}>{t('bug.previewBeforeSubmit')}</Text>
            <View style={styles.previewCard}>
                <Text style={styles.previewKicker}>{t('bug.pendingNewDisplayId')}</Text>
                <Text style={styles.previewTitle} numberOfLines={3}>{previewTitle}</Text>
                <View style={styles.previewMetaRow}>
                    <View style={styles.statusPill}>
                        <View style={styles.statusDot} />
                        <Text style={styles.statusPillText}>{bugStatusLabel('pending')}</Text>
                    </View>
                    <Text style={styles.previewMetaText}>{imageCountLabel} · 0 {t('bug.comment')}</Text>
                </View>
            </View>

            <View style={styles.keyValueList}>
                <View style={styles.keyValueRow}><Text style={styles.keyText}>{t('bug.submitter')}</Text><Text style={styles.valueText}>{t('bug.currentNickname')}</Text></View>
                <View style={styles.keyValueRow}><Text style={styles.keyText}>{t('bug.visibility')}</Text><Text style={styles.valueText}>{t('bug.sharedMembers')}</Text></View>
                <View style={styles.keyValueRow}><Text style={styles.keyText}>{t('bug.initialStatus')}</Text><Text style={styles.valueText}>{bugStatusLabel('pending')}</Text></View>
                <View style={styles.keyValueRow}><Text style={styles.keyText}>{t('bug.afterSubmit')}</Text><Text style={styles.valueText}>{t('bug.openDetail')}</Text></View>
            </View>

            <View style={styles.sideNote}>
                <Text style={styles.sideNoteText}>{t('bug.contentRequiredHint')}</Text>
            </View>
        </>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: {
        backgroundColor: theme.colors.surface,
        borderRadius: 28,
        overflow: 'hidden',
    },
    modalCompact: {
        borderRadius: 22,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 28,
        paddingVertical: 22,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        color: theme.colors.text,
        fontSize: 28,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 6,
        ...Typography.default(),
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    body: {
        flexDirection: 'row',
        minHeight: 0,
        flex: 1,
    },
    bodyCompact: {
        flexDirection: 'column',
    },
    mainScroll: {
        flex: 1,
        minWidth: 0,
    },
    mainContent: {
        padding: 28,
        gap: 12,
    },
    fieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    label: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    requiredMark: {
        color: theme.colors.deleteAction,
    },
    imageCount: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    composer: {
        minHeight: 520,
        borderWidth: 2,
        borderColor: theme.colors.text,
        borderRadius: 22,
        backgroundColor: theme.colors.input.background,
        overflow: 'hidden',
    },
    input: {
        minHeight: 270,
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 10,
        color: theme.colors.text,
        fontSize: 17,
        lineHeight: 26,
        ...Typography.default(),
    },
    placeholder: {
        color: theme.colors.textSecondary,
    },
    dropZone: {
        marginHorizontal: 18,
        marginBottom: 18,
        padding: 16,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    dropHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        marginBottom: 12,
    },
    dropHeaderText: {
        flex: 1,
        minWidth: 0,
    },
    dropTitle: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    dropHint: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 4,
        ...Typography.default(),
    },
    shortcut: {
        color: theme.colors.button.primary.tint,
        backgroundColor: theme.colors.button.primary.background,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
        fontSize: 12,
        overflow: 'hidden',
        ...Typography.default('semiBold'),
    },
    emptyImageRow: {
        minHeight: 58,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    emptyImageText: {
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    helperChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    helperChip: {
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 12,
        overflow: 'hidden',
        ...Typography.default('semiBold'),
    },
    sidePanel: {
        width: 300,
        borderLeftWidth: 1,
        borderLeftColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHigh,
        padding: 24,
    },
    mobilePreview: {
        marginTop: 4,
        padding: 16,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    sideTitle: {
        color: theme.colors.text,
        fontSize: 17,
        marginBottom: 14,
        ...Typography.default('semiBold'),
    },
    previewCard: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 18,
        padding: 16,
        marginBottom: 14,
    },
    previewKicker: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    previewTitle: {
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 24,
        marginTop: 8,
        marginBottom: 12,
        ...Typography.default('semiBold'),
    },
    previewMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: '#FFF2C7',
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: PENDING_STATUS_COLOR,
    },
    statusPillText: {
        color: '#854D0E',
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    previewMetaText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    keyValueList: {
        gap: 10,
    },
    keyValueRow: {
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    keyText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default(),
    },
    valueText: {
        color: theme.colors.text,
        fontSize: 13,
        textAlign: 'right',
        ...Typography.default('semiBold'),
    },
    sideNote: {
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#F0DEA3',
        backgroundColor: '#FFF8DB',
        borderRadius: 14,
        padding: 13,
    },
    sideNoteText: {
        color: '#745000',
        fontSize: 13,
        lineHeight: 19,
        ...Typography.default('semiBold'),
    },
    footer: {
        minHeight: 74,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 28,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    footerCompact: {
        alignItems: 'stretch',
        flexDirection: 'column',
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
        gap: 12,
    },
    footerActionsCompact: {
        justifyContent: 'flex-end',
    },
    cancelButton: {
        borderRadius: 15,
        paddingHorizontal: 22,
        paddingVertical: 14,
        backgroundColor: theme.colors.surfaceHigh,
    },
    cancelButtonText: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    primaryButton: {
        minWidth: 168,
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
