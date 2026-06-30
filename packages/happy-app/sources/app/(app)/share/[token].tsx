import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { View, FlatList, ActivityIndicator, Pressable, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { MessageView } from '@/components/MessageView';
import { usePublicShareSession } from '@/hooks/usePublicShareSession';
import { Message } from '@/sync/typesMessage';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useFileAttachments } from '@/hooks/useFileAttachments';
import type { LocalImage } from '@/components/ImagePreview';
import type { LocalFileAttachment } from '@/utils/fileAttachments';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { AgentInput } from '@/components/AgentInput';

function getOwnerDisplayName(owner: { username: string | null; firstName: string | null; lastName: string | null }): string {
    return owner.username
        || [owner.firstName, owner.lastName].filter(Boolean).join(' ')
        || 'Unknown';
}

function OwnerCard({ owner, floating }: { owner: { username: string | null; firstName: string | null; lastName: string | null }; floating?: boolean }) {
    const { theme } = useUnistyles();
    const name = getOwnerDisplayName(owner);

    return (
        <View style={[styles.ownerCard, floating && styles.ownerCardFloating, { backgroundColor: theme.colors.groupped.background }]}>
            <Ionicons name="person-circle-outline" size={32} color={theme.colors.textSecondary} />
            <View style={styles.ownerInfo}>
                <Text style={[styles.ownerLabel, { color: theme.colors.textSecondary }]}>
                    {t('session.sharing.sharedBy')}
                </Text>
                <Text style={[styles.ownerName, { color: theme.colors.text }]}>
                    {name}
                </Text>
            </View>
        </View>
    );
}

function ShareHeader({ owner }: { owner: { username: string | null; firstName: string | null; lastName: string | null } | null }) {
    const { theme } = useUnistyles();
    const name = owner ? getOwnerDisplayName(owner) : null;

    return (
        <View style={[styles.shareHeader, { borderBottomColor: theme.colors.divider }]}>
            <Text style={[styles.shareTitle, { color: theme.colors.text }]}>
                {t('session.sharing.sharedSession')}
            </Text>
            {name && (
                <View style={styles.shareOwnerInline}>
                    <Ionicons name="person-circle-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={[styles.ownerLabel, { color: theme.colors.textSecondary }]}>
                        {t('session.sharing.sharedBy')}
                    </Text>
                    <Text style={[styles.ownerName, { color: theme.colors.text }]} numberOfLines={1}>
                        {name}
                    </Text>
                </View>
            )}
        </View>
    );
}

function PublicShareAgentInput({
    disabled,
    onSend,
}: {
    disabled: boolean;
    onSend: (text: string, attachments?: {
        images: LocalImage[];
        fileAttachments: LocalFileAttachment[];
    }) => Promise<boolean>;
}) {
    const { theme } = useUnistyles();
    const [text, setText] = useState('');
    const {
        images,
        pickFromGallery,
        pickFromCamera,
        addImageFromUri,
        clearImages,
        initImages,
        canAddMore,
    } = useImagePicker({ maxImages: 4 });
    const {
        fileAttachments,
        setFileAttachments,
        addFiles,
        pickFiles,
        clearFileAttachments,
    } = useFileAttachments();
    const [pickerVisible, setPickerVisible] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sendInFlightRef = useRef(false);

    const handleSend = useCallback(async (textSnapshot?: string) => {
        const next = (textSnapshot ?? text).trim();
        if ((!next && images.length === 0 && fileAttachments.length === 0) || disabled || sendInFlightRef.current) return;
        sendInFlightRef.current = true;
        try {
            const sent = await onSend(next, { images, fileAttachments });
            if (sent) {
                setText('');
                clearImages();
                clearFileAttachments();
            }
        } finally {
            sendInFlightRef.current = false;
        }
    }, [clearFileAttachments, clearImages, disabled, fileAttachments, images, onSend, text]);

    const pickerItems: ActionMenuItem[] = useMemo(() => [
        { label: t('session.takePhoto'), onPress: pickFromCamera },
        { label: t('session.chooseFromLibrary'), onPress: pickFromGallery },
        { label: t('dootask.chooseFromFile'), onPress: pickFiles },
    ], [pickFiles, pickFromCamera, pickFromGallery]);

    const addPickedFiles = useCallback((files: File[]) => {
        let remainingImageSlots = canAddMore ? Math.max(0, 4 - images.length) : 0;
        files.forEach(file => {
            if (file.type.startsWith('image/') && remainingImageSlots > 0) {
                remainingImageSlots -= 1;
                const url = URL.createObjectURL(file);
                void addImageFromUri(url, file.type);
            } else {
                void addFiles([{ blob: file, name: file.name, size: file.size, mimeType: file.type }]);
            }
        });
    }, [addFiles, addImageFromUri, canAddMore, images.length]);

    const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        addPickedFiles(Array.from(files));
        event.target.value = '';
    }, [addPickedFiles]);

    const handleAttachmentPress = useCallback(() => {
        if (Platform.OS === 'web') {
            fileInputRef.current?.click();
        } else {
            setPickerVisible(true);
        }
    }, []);

    const autocompleteSuggestions = useCallback(async () => [], []);

    return (
        <View style={[styles.inputBar, { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
            {Platform.OS === 'web' && (
                <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="*/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange as any}
                />
            )}
            <AgentInput
                value={text}
                placeholder={t('session.sharing.publicChatPlaceholder')}
                onChangeText={setText}
                onSend={handleSend}
                autocompletePrefixes={[]}
                autocompleteSuggestions={autocompleteSuggestions}
                images={images}
                onImagesChange={initImages}
                fileAttachments={fileAttachments}
                onFileAttachmentsChange={setFileAttachments}
                onImageButtonPress={handleAttachmentPress}
                supportsImages
                onImageDrop={addPickedFiles}
                isSending={disabled}
                isSendDisabled={disabled}
                hidePermissionSettings
                minHeight={52}
            />
            {Platform.OS !== 'web' && (
                <ActionMenuModal
                    visible={pickerVisible}
                    items={pickerItems}
                    onClose={() => setPickerVisible(false)}
                    deferItemPress
                />
            )}
        </View>
    );
}

export default memo(function PublicShareScreen() {
    const { token } = useLocalSearchParams<{ token: string }>();
    const { theme } = useUnistyles();
    const { state, messages, metadata, owner, sessionId, allowChat, isSending, hasMore, isLoadingMore, loadMore, giveConsent, sendMessage } = usePublicShareSession(token);

    const keyExtractor = useCallback((item: Message) => item.id, []);
    const renderItem = useCallback(({ item }: { item: Message }) => (
        <MessageView
            message={item}
            metadata={metadata}
            sessionId={sessionId || ''}
            readOnly
        />
    ), [metadata, sessionId]);

    const listFooter = useCallback(() => (
        hasMore || isLoadingMore ? (
            <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        ) : null
    ), [hasMore, isLoadingMore, theme.colors.textSecondary]);

    // Loading
    if (state === 'loading') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <ActivityIndicator size="large" color={theme.colors.textSecondary} />
            </View>
        );
    }

    // Not found
    if (state === 'not-found') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <Ionicons name="link-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.statusText, { color: theme.colors.text }]}>
                    {t('session.sharing.shareNotFound')}
                </Text>
            </View>
        );
    }

    // Error / decrypt failed
    if (state === 'error') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                <Ionicons name="lock-closed-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.statusText, { color: theme.colors.text }]}>
                    {t('session.sharing.failedToDecrypt')}
                </Text>
            </View>
        );
    }

    // Consent required
    if (state === 'consent-required') {
        return (
            <View style={[styles.center, { backgroundColor: theme.colors.surface }]}>
                {owner && <OwnerCard owner={owner} floating />}
                <Ionicons name="shield-checkmark-outline" size={48} color={theme.colors.textSecondary} style={{ marginTop: 24 }} />
                <Text style={[styles.consentTitle, { color: theme.colors.text }]}>
                    {t('session.sharing.consentTitle')}
                </Text>
                <Text style={[styles.consentMessage, { color: theme.colors.textSecondary }]}>
                    {t('session.sharing.consentMessage')}
                </Text>
                <Pressable
                    onPress={giveConsent}
                    style={[styles.consentButton, { backgroundColor: theme.colors.button.primary.background }]}
                >
                    <Text style={[styles.consentButtonText, { color: theme.colors.button.primary.tint }]}>
                        {t('session.sharing.consentAccept')}
                    </Text>
                </Pressable>
            </View>
        );
    }

    // Loaded
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <ShareHeader owner={owner} />
            <View style={styles.messageArea}>
                {messages.length === 0 ? (
                    <View style={styles.center}>
                        <Ionicons name="chatbubble-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                            {t('session.sharing.noMessages')}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={messages}
                        keyExtractor={keyExtractor}
                        renderItem={renderItem}
                        inverted
                        maintainVisibleContentPosition={{
                            minIndexForVisible: 0,
                        }}
                        contentContainerStyle={styles.listContent}
                        ListFooterComponent={listFooter}
                        onEndReached={loadMore}
                        onEndReachedThreshold={0.5}
                    />
                )}
            </View>
            {allowChat && (
                <PublicShareAgentInput disabled={isSending} onSend={sendMessage} />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    messageArea: {
        flex: 1,
        minHeight: 0,
    },
    statusText: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        marginTop: 16,
        textAlign: 'center',
    },
    shareHeader: {
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 0.5,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        flexWrap: 'nowrap',
    },
    shareTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        flexShrink: 0,
    },
    shareOwnerInline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        flexShrink: 1,
        flexWrap: 'nowrap',
    },
    ownerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    ownerCardFloating: {
        borderBottomWidth: 0,
        borderRadius: 12,
    },
    ownerInfo: {
        marginLeft: 12,
    },
    ownerLabel: {
        fontSize: 12,
    },
    ownerName: {
        ...Typography.default('semiBold'),
        fontSize: 15,
    },
    consentTitle: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        marginTop: 16,
        textAlign: 'center',
    },
    consentMessage: {
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
        lineHeight: 22,
    },
    consentButton: {
        marginTop: 24,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 10,
    },
    consentButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 17,
    },
    listContent: {
        paddingVertical: 8,
    },
    loadingMore: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    inputBar: {
        borderTopWidth: 0.5,
    },
}));
