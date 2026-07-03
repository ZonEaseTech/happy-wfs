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

const STATUS_OPTIONS: BugStatus[] = ['pending', 'in_progress', 'verify', 'closed'];

export function BugReportDetailModal({
    bug,
    onClose,
    onBugUpdated,
    onAddComment,
    onUploadImages,
    onChangeStatus,
    onStartSession,
}: {
    bug: BugReportDetail;
    onClose: () => void;
    onBugUpdated?: (bug: BugReportDetail) => void;
    onAddComment?: (bug: BugReportDetail, body: string, images: LocalImage[]) => Promise<BugReportDetail>;
    onUploadImages?: (bug: BugReportDetail, images: LocalImage[], commentId?: string) => Promise<BugReportDetail>;
    onChangeStatus?: (bug: BugReportDetail, status: BugStatus, action?: 'return_to_pending') => Promise<BugReportDetail>;
    onStartSession?: (bug: BugReportDetail) => void;
}) {
    const styles = stylesheet;
    const [currentBug, setCurrentBug] = React.useState(bug);
    const [comment, setComment] = React.useState('');
    const [busy, setBusy] = React.useState(false);
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

    const handleStatus = React.useCallback((status: BugStatus, action?: 'return_to_pending') => {
        if (!onChangeStatus) return;
        void run(() => onChangeStatus(currentBug, status, action));
    }, [currentBug, onChangeStatus, run]);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        Array.from(files).slice(0, BUG_IMAGE_LIMITS.maxImages).forEach(file => {
            const url = URL.createObjectURL(file);
            void picker.addImageFromUri(url, file.type || 'image/jpeg');
        });
        event.target.value = '';
    }, [picker]);

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
                <Text style={styles.description} selectable>{currentBug.description}</Text>

                <Text style={styles.sectionTitle}>{t('bug.screenshots')}</Text>
                {currentBug.attachments.length === 0 ? <Text style={styles.muted}>-</Text> : (
                    <View style={styles.grid}>
                        {currentBug.attachments.map(attachment => (
                            <Image key={attachment.id} source={{ uri: attachment.url }} style={styles.image} contentFit="cover" />
                        ))}
                    </View>
                )}

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

                <Text style={styles.sectionTitle}>{t('bug.status')}</Text>
                <View style={styles.statusRow}>
                    {STATUS_OPTIONS.map(status => (
                        <Pressable key={status} style={[styles.statusChip, currentBug.status === status && styles.statusChipActive]} onPress={() => handleStatus(status)}>
                            <Text style={[styles.statusChipText, currentBug.status === status && styles.statusChipTextActive]}>{bugStatusLabel(status)}</Text>
                        </Pressable>
                    ))}
                    {currentBug.status !== 'pending' && (
                        <Pressable style={styles.statusChip} onPress={() => handleStatus('pending', 'return_to_pending')}>
                            <Text style={styles.statusChipText}>{t('bug.returnToPending')}</Text>
                        </Pressable>
                    )}
                </View>

                <Text style={styles.sectionTitle}>{t('bug.statusHistory')}</Text>
                {currentBug.statusHistory.map(entry => (
                    <Text key={entry.id} style={styles.history}>{entry.actorNickname ?? t('bug.system')} · {formatBugStatusHistoryAction(entry)}</Text>
                ))}
            </ScrollView>
            <View style={styles.footer}>
                {onStartSession && (
                    <Pressable style={styles.primaryButton} onPress={() => { onClose(); onStartSession(currentBug); }}>
                        <Text style={styles.primaryButtonText}>{t('bug.startRepairSession')}</Text>
                    </Pressable>
                )}
            </View>
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
    primaryButton: { flex: 1, alignItems: 'center', padding: 13, borderRadius: 14, backgroundColor: theme.colors.button.primary.background },
    primaryButtonText: { color: theme.colors.button.primary.tint, ...Typography.default('semiBold') },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.surfaceHigh },
    statusChipActive: { backgroundColor: theme.colors.button.primary.background },
    statusChipText: { color: theme.colors.text, ...Typography.default('semiBold') },
    statusChipTextActive: { color: theme.colors.button.primary.tint },
    history: { color: theme.colors.textSecondary, marginBottom: 6, ...Typography.default() },
    footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: theme.colors.divider },
    busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.45)' },
}));
