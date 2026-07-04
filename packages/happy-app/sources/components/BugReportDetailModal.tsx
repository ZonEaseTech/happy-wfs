import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import { ImagePreview, type LocalImage } from '@/components/ImagePreview';
import { useImagePicker } from '@/hooks/useImagePicker';
import { BUG_IMAGE_LIMITS, bugStatusLabel, formatBugStatusHistoryAction, type BugReportDetail, type BugReportSummary, type BugStatus } from '@/sync/bugTypes';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { BugRichContentView } from '@/components/BugRichContentView';
import { BugImagePreviewModal } from '@/components/BugImagePreviewModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import { BugTiptapEditor } from './BugTiptapEditor';
import type { BugTiptapEditorHandle, BugTiptapEditorSnapshot } from './BugTiptapEditor.types';
import { bugRichContentToTiptapDoc, bugTiptapDocWithAttachmentUrls, type BugTiptapDoc } from '@/sync/bugRichContent';
import { buildBugPreviewImages, findBugPreviewImageIndex } from './bugImagePreview';

const STATUS_OPTIONS: BugStatus[] = ['pending', 'in_progress', 'verify', 'closed'];

function isBugReportDetail(bug: BugReportSummary | BugReportDetail): bug is BugReportDetail {
    return 'comments' in bug;
}

function bugSummaryToDetail(bug: BugReportSummary | BugReportDetail): BugReportDetail {
    if (isBugReportDetail(bug)) return bug;
    return {
        ...bug,
        sessionId: null,
        attachments: [],
        comments: [],
        statusHistory: [],
    };
}

export function BugReportDetailModal({
    bug,
    loadBug,
    onClose,
    onBugUpdated,
    onAddComment,
    onUploadImages,
    onUpdateContent,
    onChangeStatus,
    onStartSession,
    onDelete,
}: {
    bug: BugReportSummary | BugReportDetail;
    loadBug?: (bugId: string) => Promise<BugReportDetail>;
    onClose: () => void;
    onBugUpdated?: (bug: BugReportDetail) => void;
    onAddComment?: (bug: BugReportDetail, body: string, images: LocalImage[]) => Promise<BugReportDetail>;
    onUploadImages?: (bug: BugReportDetail, images: LocalImage[], commentId?: string) => Promise<BugReportDetail>;
    onUpdateContent?: (bug: BugReportDetail, description: string, contentJson: BugTiptapDoc | null | undefined, images: LocalImage[]) => Promise<BugReportDetail>;
    onChangeStatus?: (bug: BugReportDetail, status: BugStatus, action?: 'return_to_pending') => Promise<BugReportDetail>;
    onStartSession?: (bug: BugReportDetail) => void;
    onDelete?: (bug: BugReportDetail) => Promise<void>;
}) {
    const styles = stylesheet;
    const windowSize = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const [currentBug, setCurrentBug] = React.useState<BugReportDetail>(() => bugSummaryToDetail(bug));
    const [detailLoading, setDetailLoading] = React.useState(() => !isBugReportDetail(bug) && !!loadBug);
    const [comment, setComment] = React.useState('');
    const [contentEditing, setContentEditing] = React.useState(false);
    const [contentSnapshot, setContentSnapshot] = React.useState<BugTiptapEditorSnapshot | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [statusMenuVisible, setStatusMenuVisible] = React.useState(false);
    const [previewVisible, setPreviewVisible] = React.useState(false);
    const [previewIndex, setPreviewIndex] = React.useState(0);
    const picker = useImagePicker({ maxImages: BUG_IMAGE_LIMITS.maxImages, maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes });
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const contentEditorRef = React.useRef<BugTiptapEditorHandle>(null);

    const updateBug = React.useCallback((updated: BugReportDetail) => {
        setCurrentBug(updated);
        onBugUpdated?.(updated);
    }, [onBugUpdated]);

    React.useEffect(() => {
        setCurrentBug(bugSummaryToDetail(bug));
        setDetailLoading(!isBugReportDetail(bug) && !!loadBug);
        setContentEditing(false);
        setContentSnapshot(null);
    }, [bug, loadBug]);

    React.useEffect(() => {
        if (isBugReportDetail(bug) || !loadBug) return;
        let cancelled = false;
        setDetailLoading(true);
        loadBug(bug.id).then((detail) => {
            if (cancelled) return;
            updateBug(detail);
        }).catch((error) => {
            if (!cancelled) Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }).finally(() => {
            if (!cancelled) setDetailLoading(false);
        });
        return () => { cancelled = true; };
    }, [bug, loadBug, updateBug]);

    const detailModalLayout = React.useMemo(() => {
        const compact = windowSize.width < 600;
        const horizontalMargin = compact ? 12 : Math.max(24, windowSize.width * 0.02);
        const verticalMargin = compact ? 10 : Math.max(24, windowSize.height * 0.04);
        const width = compact
            ? Math.max(280, windowSize.width - horizontalMargin * 2)
            : Math.min(860, windowSize.width - horizontalMargin * 2);
        const maxHeight = Math.max(
            320,
            windowSize.height - safeArea.top - safeArea.bottom - verticalMargin * 2,
        );
        return {
            modal: {
                width,
                maxWidth: width,
                maxHeight,
            },
            body: {
                maxHeight: Math.max(180, maxHeight - (compact ? 188 : 172)),
            },
        };
    }, [safeArea.bottom, safeArea.top, windowSize.height, windowSize.width]);

    const run = React.useCallback(async (fn: () => Promise<BugReportDetail>) => {
        setBusy(true);
        try {
            updateBug(await fn());
            picker.clearImages();
            setComment('');
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [picker, updateBug]);

    const handleComment = React.useCallback(() => {
        const body = comment.trim();
        if (!body || !onAddComment) return;
        void run(() => onAddComment(currentBug, body, picker.images));
    }, [comment, currentBug, onAddComment, picker.images, run]);

    const handleUploadOnly = React.useCallback(() => {
        if (!onUploadImages || picker.images.length === 0) return;
        void run(() => onUploadImages(currentBug, picker.images));
    }, [currentBug, onUploadImages, picker.images, run]);

    const contentInitialDoc = React.useMemo(
        () => currentBug.contentJson?.content?.length
            ? bugTiptapDocWithAttachmentUrls(currentBug.contentJson, currentBug.attachments)
            : bugRichContentToTiptapDoc(currentBug.description, currentBug.attachments),
        [currentBug.attachments, currentBug.contentJson, currentBug.description],
    );
    const contentAttachmentUrls = React.useMemo(
        () => currentBug.attachments.map(attachment => attachment.url),
        [currentBug.attachments],
    );
    const canEditContent = Platform.OS === 'web' && !!onUpdateContent && !detailLoading;

    const handleSaveContent = React.useCallback(async () => {
        if (!onUpdateContent || busy) return;
        const snapshot = contentEditorRef.current?.getSnapshot() ?? contentSnapshot;
        if (!snapshot || !snapshot.plainText.trim()) {
            Modal.alert(t('common.error'), t('bug.contentRequiredHint'));
            return;
        }
        setBusy(true);
        try {
            const updated = await onUpdateContent(currentBug, snapshot.description, snapshot.contentJson, snapshot.images);
            updateBug(updated);
            setContentEditing(false);
            setContentSnapshot(null);
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [busy, contentSnapshot, currentBug, onUpdateContent, updateBug]);

    const handleDelete = React.useCallback(async () => {
        if (!onDelete || busy) return;
        const confirmed = await Modal.confirm(
            t('bug.deleteHideConfirmTitle'),
            t('bug.deleteHideConfirmMessage'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('bug.deleteHide'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            await onDelete(currentBug);
            onClose();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [busy, currentBug, onClose, onDelete]);

    const handleStatus = React.useCallback((status: BugStatus, action?: 'return_to_pending') => {
        if (!onChangeStatus) return;
        setStatusMenuVisible(false);
        void run(() => onChangeStatus(currentBug, status, action));
    }, [currentBug, onChangeStatus, run]);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        Array.from(files).slice(0, BUG_IMAGE_LIMITS.maxImages).forEach(file => {
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
        if (contentEditing) return;
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
    }, [contentEditing, picker]);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const pasteListener = (event: Event) => { void handlePaste(event as ClipboardEvent); };
        document.addEventListener('paste', pasteListener);
        return () => document.removeEventListener('paste', pasteListener);
    }, [handlePaste]);

    const statusMenuItems = React.useMemo<ActionMenuItem[]>(() => {
        const items: ActionMenuItem[] = [];
        if (currentBug.status !== 'pending') {
            items.push({
                label: t('bug.returnToPending'),
                onPress: () => handleStatus('pending', 'return_to_pending'),
            });
        }
        for (const status of STATUS_OPTIONS) {
            if (status === 'pending' && currentBug.status !== 'pending') continue;
            items.push({
                label: bugStatusLabel(status),
                selected: currentBug.status === status,
                onPress: () => handleStatus(status),
            });
        }
        return items;
    }, [currentBug.status, handleStatus]);

    const previewImages = React.useMemo(
        () => buildBugPreviewImages(currentBug),
        [currentBug],
    );
    const openBugImagePreview = React.useCallback((attachment: { url: string }) => {
        setPreviewIndex(findBugPreviewImageIndex(previewImages, attachment.url));
        setPreviewVisible(true);
    }, [previewImages]);
    const handleCommentImagePress = React.useCallback((attachment: { url: string }) => {
        openBugImagePreview(attachment);
    }, [openBugImagePreview]);

    return (
        <View style={[styles.modal, detailModalLayout.modal]}>
            <View style={styles.header}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.kicker}>{currentBug.displayId} · {bugStatusLabel(currentBug.status)}</Text>
                    <Text style={styles.title} numberOfLines={2}>{currentBug.title}</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={styles.title.color} /></Pressable>
            </View>
            <ScrollView style={[styles.body, detailModalLayout.body]} keyboardShouldPersistTaps="handled">
                <View style={styles.fieldHeader}>
                    <Text style={styles.sectionTitle}>{t('bug.description')}</Text>
                    <View style={styles.fieldHeaderActions}>
                        <Text style={styles.imageCount}>
                            {t('bug.imageCounter', { count: contentEditing ? (contentSnapshot?.imageCount ?? currentBug.attachments.length) : currentBug.attachments.length, max: BUG_IMAGE_LIMITS.maxImages })}
                        </Text>
                        {canEditContent && (
                            <Pressable
                                style={styles.editTextButton}
                                disabled={busy}
                                onPress={() => {
                                    setContentSnapshot(null);
                                    setContentEditing(value => !value);
                                }}
                                hitSlop={8}
                            >
                                <Ionicons name={contentEditing ? 'close-outline' : 'create-outline'} size={16} color={styles.editTextButtonText.color} />
                                <Text style={styles.editTextButtonText}>{contentEditing ? t('common.cancel') : t('bug.editContent')}</Text>
                            </Pressable>
                        )}
                    </View>
                </View>
                {detailLoading && (
                    <View style={styles.detailLoading}>
                        <ActivityIndicator size="small" />
                        <Text style={styles.loadingText}>{t('bug.loadingBugs')}</Text>
                    </View>
                )}
                {contentEditing && canEditContent ? (
                    <View style={[styles.notePaper, styles.notePaperEditing]}>
                        <View style={styles.contentEditToolbar}>
                            <Text style={styles.contentEditTitle}>{t('bug.editingContent')}</Text>
                            <View style={styles.contentEditToolbarActions}>
                                <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setContentEditing(false)}>
                                    <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
                                </Pressable>
                                <Pressable style={styles.primaryButtonSmall} disabled={busy || !(contentSnapshot?.plainText.trim())} onPress={() => { void handleSaveContent(); }}>
                                    {busy
                                        ? <Text style={styles.primaryButtonText}>{t('bug.savingContent')}</Text>
                                        : <Text style={styles.primaryButtonText}>{t('common.save')}</Text>}
                                </Pressable>
                            </View>
                        </View>
                        <BugTiptapEditor
                            ref={contentEditorRef}
                            initialDoc={contentInitialDoc}
                            initialContentKey={`${currentBug.id}:${currentBug.updatedAt}`}
                            attachmentImageUrls={contentAttachmentUrls}
                            onChange={setContentSnapshot}
                            variant="detail"
                        />
                    </View>
                ) : (
                    <View style={styles.notePaper}>
                        <BugRichContentView description={currentBug.description} contentJson={currentBug.contentJson} attachments={currentBug.attachments} noteStyle onImagePress={openBugImagePreview} />
                    </View>
                )}

                <Text style={styles.sectionTitle}>{t('bug.comment')}</Text>
                {currentBug.comments.map(item => (
                    <View key={item.id} style={styles.comment}>
                        <Text style={styles.commentAuthor}>{item.authorNickname ?? t('bug.anonymousUser')}</Text>
                        <Text style={styles.commentBody}>{item.body}</Text>
                        {item.attachments.length > 0 && (
                            <View style={styles.grid}>{item.attachments.map(attachment => (
                                <Pressable key={attachment.id} onPress={() => handleCommentImagePress(attachment)}>
                                    <Image source={{ uri: attachment.url }} style={styles.smallImage} contentFit="cover" />
                                </Pressable>
                            ))}</View>
                        )}
                    </View>
                ))}

                <TextInput
                    style={styles.commentInput}
                    value={comment}
                    onChangeText={setComment}
                    placeholder={t('bug.addComment')}
                    placeholderTextColor={styles.muted.color}
                    multiline
                />
                <ImagePreview images={picker.images} onRemove={picker.removeImage} maxImages={BUG_IMAGE_LIMITS.maxImages} />
                <View style={styles.actionRow}>
                    <Pressable style={styles.secondaryButton} onPress={() => Platform.OS === 'web' ? fileInputRef.current?.click() : picker.pickFromGallery()}>
                        <Text style={styles.secondaryButtonText}>{t('bug.uploadScreenshots')}</Text>
                    </Pressable>
                    {picker.images.length > 0 && <Pressable style={styles.secondaryButton} onPress={handleUploadOnly}><Text style={styles.secondaryButtonText}>{t('bug.uploadOnly')}</Text></Pressable>}
                    <Pressable style={styles.primaryButtonSmall} onPress={handleComment}><Text style={styles.primaryButtonText}>{t('bug.addComment')}</Text></Pressable>
                </View>
                {Platform.OS === 'web' && <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />}

                <Text style={styles.sectionTitle}>{t('bug.statusHistory')}</Text>
                {currentBug.statusHistory.map(entry => (
                    <Text key={entry.id} style={styles.history}>{entry.actorNickname ?? t('bug.system')} · {formatBugStatusHistoryAction(entry)}</Text>
                ))}
            </ScrollView>
            <View style={styles.footer}>
                <Pressable style={styles.footerAction} onPress={onClose}>
                    <Text style={styles.footerActionText}>{t('bug.close')}</Text>
                </Pressable>
                {onDelete && (
                    <>
                        <View style={styles.footerActionSeparator} />
                        <Pressable style={styles.footerAction} disabled={busy} onPress={() => { void handleDelete(); }}>
                            <Text style={styles.footerDeleteText}>{t('bug.deleteHide')}</Text>
                        </Pressable>
                    </>
                )}
                <View style={styles.footerActionSeparator} />
                <Pressable style={styles.footerAction} disabled={busy || !onChangeStatus} onPress={() => setStatusMenuVisible(true)}>
                    <Text style={styles.footerActionText}>{busy ? t('bug.updatingStatus') : t('bug.changeStatus')}</Text>
                </Pressable>
                {onStartSession && (
                    <>
                        <View style={styles.footerActionSeparator} />
                        <Pressable style={styles.footerAction} disabled={detailLoading} onPress={() => { onClose(); onStartSession(currentBug); }}>
                            <Text style={styles.footerActionText}>{t('bug.startRepairSession')}</Text>
                        </Pressable>
                    </>
                )}
            </View>
            <ActionMenuModal
                visible={statusMenuVisible}
                title={`${t('bug.changeStatus')}：${bugStatusLabel(currentBug.status)}`}
                items={statusMenuItems}
                onClose={() => setStatusMenuVisible(false)}
            />
            <BugImagePreviewModal
                images={previewImages}
                initialIndex={previewIndex}
                visible={previewVisible}
                onClose={() => setPreviewVisible(false)}
            />
            {busy && <View style={styles.busy}><ActivityIndicator /></View>}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: {
        backgroundColor: '#FDFBF7',
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E6E1D8',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#E8E1D4',
        backgroundColor: '#F8F5EE',
    },
    kicker: { color: theme.colors.textSecondary, fontSize: 13, ...Typography.default() },
    title: { color: theme.colors.text, fontSize: 21, marginTop: 6, ...Typography.default('semiBold') },
    body: {
        paddingHorizontal: 18,
        paddingVertical: 16,
        backgroundColor: '#FDFBF7',
    },
    fieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
    },
    fieldHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    editTextButton: {
        minHeight: 32,
        borderRadius: 16,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        justifyContent: 'center',
        backgroundColor: '#F3EFE7',
    },
    editTextButtonText: {
        color: theme.colors.text,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    sectionTitle: { color: theme.colors.text, fontSize: 15, marginTop: 14, marginBottom: 8, ...Typography.default('semiBold') },
    imageCount: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    detailLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    loadingText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default(),
    },
    notePaper: {
        minHeight: 220,
        borderWidth: 1,
        borderColor: '#E6E1D8',
        borderRadius: 22,
        backgroundColor: '#FFFEFB',
        paddingHorizontal: 26,
        paddingVertical: 24,
        marginBottom: 18,
    },
    notePaperEditing: {
        paddingHorizontal: 18,
        paddingVertical: 18,
    },
    contentEditToolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#EFE8DC',
    },
    contentEditTitle: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    contentEditToolbarActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    description: { color: theme.colors.text, lineHeight: 22, ...Typography.default() },
    muted: { color: theme.colors.textSecondary, ...Typography.default() },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    image: { width: 112, height: 84, borderRadius: 10, backgroundColor: theme.colors.surfaceHigh },
    smallImage: { width: 72, height: 56, borderRadius: 8, backgroundColor: theme.colors.surfaceHigh, marginTop: 8 },
    comment: { backgroundColor: theme.colors.surfaceHigh, borderRadius: 12, padding: 12, marginBottom: 8 },
    commentAuthor: { color: theme.colors.textSecondary, fontSize: 12, ...Typography.default('semiBold') },
    commentBody: { color: theme.colors.text, marginTop: 6, lineHeight: 20, ...Typography.default() },
    commentInput: { minHeight: 76, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, padding: 10, color: theme.colors.text, backgroundColor: theme.colors.input.background, ...Typography.default() },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    secondaryButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh },
    secondaryButtonText: { color: theme.colors.text, ...Typography.default('semiBold') },
    primaryButtonSmall: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.button.primary.background },
    primaryButtonText: { color: theme.colors.button.primary.tint, ...Typography.default('semiBold') },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.surfaceHigh },
    statusChipActive: { backgroundColor: theme.colors.button.primary.background },
    statusChipText: { color: theme.colors.text, ...Typography.default('semiBold') },
    statusChipTextActive: { color: theme.colors.button.primary.tint },
    history: { color: theme.colors.textSecondary, marginBottom: 6, ...Typography.default() },
    footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E8E1D4', minHeight: 56, backgroundColor: '#F8F5EE' },
    footerAction: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    footerActionSeparator: { width: 1, backgroundColor: theme.colors.divider },
    footerActionText: { fontSize: 16, color: theme.colors.button.primary.background, ...Typography.default('semiBold') },
    footerDeleteText: { fontSize: 16, color: theme.colors.status.error, ...Typography.default('semiBold') },
    busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.45)' },
}));
