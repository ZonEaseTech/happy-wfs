import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import { ImagePreview, type LocalImage } from '@/components/ImagePreview';
import { useImagePicker } from '@/hooks/useImagePicker';
import { BUG_IMAGE_LIMITS, bugStatusLabel, formatBugStatusHistoryAction, type BugReportDetail, type BugStatus } from '@/sync/bugTypes';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { BugRichContentView } from '@/components/BugRichContentView';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { handleImagePasteEvent } from '@/utils/imagePaste';

const STATUS_OPTIONS: BugStatus[] = ['pending', 'in_progress', 'verify', 'closed'];

export function BugReportDetailModal({
    bug,
    onClose,
    onBugUpdated,
    onAddComment,
    onUploadImages,
    onChangeStatus,
    onStartSession,
    onDelete,
}: {
    bug: BugReportDetail;
    onClose: () => void;
    onBugUpdated?: (bug: BugReportDetail) => void;
    onAddComment?: (bug: BugReportDetail, body: string, images: LocalImage[]) => Promise<BugReportDetail>;
    onUploadImages?: (bug: BugReportDetail, images: LocalImage[], commentId?: string) => Promise<BugReportDetail>;
    onChangeStatus?: (bug: BugReportDetail, status: BugStatus, action?: 'return_to_pending') => Promise<BugReportDetail>;
    onStartSession?: (bug: BugReportDetail) => void;
    onDelete?: (bug: BugReportDetail) => Promise<void>;
}) {
    const styles = stylesheet;
    const [currentBug, setCurrentBug] = React.useState(bug);
    const [comment, setComment] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [statusMenuVisible, setStatusMenuVisible] = React.useState(false);
    const picker = useImagePicker({ maxImages: BUG_IMAGE_LIMITS.maxImages, maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes });
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => setCurrentBug(bug), [bug]);

    const updateBug = React.useCallback((updated: BugReportDetail) => {
        setCurrentBug(updated);
        onBugUpdated?.(updated);
    }, [onBugUpdated]);

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

    return (
        <View style={styles.modal}>
            <View style={styles.header}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.kicker}>{currentBug.displayId} · {bugStatusLabel(currentBug.status)}</Text>
                    <Text style={styles.title} numberOfLines={2}>{currentBug.title}</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={styles.title.color} /></Pressable>
            </View>
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.sectionTitle}>{t('bug.description')}</Text>
                <BugRichContentView description={currentBug.description} attachments={currentBug.attachments} />

                <Text style={styles.sectionTitle}>{t('bug.comment')}</Text>
                {currentBug.comments.map(item => (
                    <View key={item.id} style={styles.comment}>
                        <Text style={styles.commentAuthor}>{item.authorNickname ?? t('bug.anonymousUser')}</Text>
                        <Text style={styles.commentBody}>{item.body}</Text>
                        {item.attachments.length > 0 && (
                            <View style={styles.grid}>{item.attachments.map(attachment => <Image key={attachment.id} source={{ uri: attachment.url }} style={styles.smallImage} contentFit="cover" />)}</View>
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
                        <Pressable style={styles.footerAction} onPress={() => { onClose(); onStartSession(currentBug); }}>
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
            {busy && <View style={styles.busy}><ActivityIndicator /></View>}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: { width: Math.min(720, (typeof window !== 'undefined' ? window.innerWidth : 720) - 32), maxHeight: '90%', backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
    kicker: { color: theme.colors.textSecondary, fontSize: 13, ...Typography.default() },
    title: { color: theme.colors.text, fontSize: 18, marginTop: 4, ...Typography.default('semiBold') },
    body: { padding: 16, maxHeight: 620 },
    sectionTitle: { color: theme.colors.text, fontSize: 15, marginTop: 14, marginBottom: 8, ...Typography.default('semiBold') },
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
    footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.divider, minHeight: 56 },
    footerAction: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    footerActionSeparator: { width: 1, backgroundColor: theme.colors.divider },
    footerActionText: { fontSize: 16, color: theme.colors.button.primary.background, ...Typography.default('semiBold') },
    footerDeleteText: { fontSize: 16, color: theme.colors.status.error, ...Typography.default('semiBold') },
    busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.45)' },
}));
