import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import { ImagePreview, type LocalImage } from '@/components/ImagePreview';
import { useImagePicker } from '@/hooks/useImagePicker';
import { BUG_IMAGE_LIMITS, type BugReportDetail } from '@/sync/bugTypes';

export function BugReportCreateModal({
    onClose,
    onCreate,
}: {
    onClose: () => void;
    onCreate: (description: string, images: LocalImage[]) => Promise<BugReportDetail>;
}) {
    const styles = stylesheet;
    const [description, setDescription] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const picker = useImagePicker({ maxImages: BUG_IMAGE_LIMITS.maxImages, maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes });
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleSubmit = React.useCallback(async () => {
        const trimmed = description.trim();
        if (!trimmed) {
            Modal.alert(t('common.error'), t('bug.descriptionPlaceholder'));
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
    }, [description, onClose, onCreate, picker.images]);

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
                <Text style={styles.title}>{t('bug.newBug')}</Text>
                <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={styles.title.color} /></Pressable>
            </View>
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>{t('bug.description')}</Text>
                <TextInput
                    style={styles.input}
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('bug.descriptionPlaceholder')}
                    placeholderTextColor={styles.placeholder.color}
                    multiline
                    textAlignVertical="top"
                />
                <Text style={styles.label}>{t('bug.screenshots')}</Text>
                <ImagePreview images={picker.images} onRemove={picker.removeImage} maxImages={BUG_IMAGE_LIMITS.maxImages} />
                <Pressable style={styles.secondaryButton} onPress={() => Platform.OS === 'web' ? fileInputRef.current?.click() : picker.pickFromGallery()}>
                    <Ionicons name="image-outline" size={18} color={styles.secondaryButtonText.color} />
                    <Text style={styles.secondaryButtonText}>{t('bug.uploadScreenshots')}</Text>
                </Pressable>
                {Platform.OS === 'web' && <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />}
            </ScrollView>
            <Pressable style={[styles.primaryButton, submitting && { opacity: 0.7 }]} disabled={submitting} onPress={handleSubmit}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t('bug.submit')}</Text>}
            </Pressable>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    modal: { width: Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 560) - 32), maxHeight: '88%', backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
    title: { color: theme.colors.text, fontSize: 18, ...Typography.default('semiBold') },
    body: { padding: 16, maxHeight: 520 },
    label: { color: theme.colors.text, fontSize: 14, marginBottom: 8, marginTop: 8, ...Typography.default('semiBold') },
    input: { minHeight: 140, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, padding: 12, color: theme.colors.text, backgroundColor: theme.colors.input.background, ...Typography.default() },
    placeholder: { color: theme.colors.textSecondary },
    secondaryButton: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh, marginTop: 12 },
    secondaryButtonText: { color: theme.colors.text, ...Typography.default('semiBold') },
    primaryButton: { margin: 16, borderRadius: 14, backgroundColor: theme.colors.button.primary.background, alignItems: 'center', padding: 14 },
    primaryButtonText: { color: theme.colors.button.primary.tint, fontSize: 16, ...Typography.default('semiBold') },
}));
