import * as React from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { BugReportCreateModal } from '@/components/BugReportCreateModal';
import { BugReportDetailModal } from '@/components/BugReportDetailModal';
import { BugRichContentView } from '@/components/BugRichContentView';
import type { LocalImage } from '@/components/ImagePreview';
import { ImagePreview } from '@/components/ImagePreview';
import { Typography } from '@/constants/Typography';
import { useBugShareBoard } from '@/hooks/useBugShareBoard';
import { useImagePicker } from '@/hooks/useImagePicker';
import { Modal } from '@/modal';
import { BUG_IMAGE_LIMITS, bugStatusLabel, formatBugStatusHistoryAction, type BugReportDetail, type BugReportSummary, type BugStatus } from '@/sync/bugTypes';
import { t } from '@/text';
import { filterBugShareBoardItems, getBugShareBoardCounts, type BugShareBoardFilter } from '@/utils/bugShareBoardPresentation';

const STATUS_OPTIONS: BugStatus[] = ['pending', 'in_progress', 'verify', 'closed'];
const STATUS_ACCENTS: Record<BugStatus, string> = {
    pending: '#F59E0B',
    in_progress: '#2563EB',
    verify: '#9333EA',
    closed: '#16A34A',
};

function getFilterLabel(filter: BugShareBoardFilter): string {
    switch (filter) {
        case 'all': return t('bug.typeAll');
        case 'open': return t('bug.filterOpen');
        case 'pending': return t('bug.statusPending');
        case 'in_progress': return t('bug.statusInProgress');
        case 'verify': return t('bug.statusVerify');
        case 'closed': return t('bug.statusClosed');
        case 'has_comments': return t('bug.filterHasComments');
        case 'has_attachments': return t('bug.filterHasAttachments');
    }
}

function getFilterAccent(filter: BugShareBoardFilter): string {
    if (filter === 'has_comments') return '#0EA5E9';
    if (filter === 'has_attachments') return '#64748B';
    if (filter === 'all' || filter === 'open') return '#111111';
    return STATUS_ACCENTS[filter];
}

export default function PublicBugBoardPage() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const isWide = width >= 1000;
    const board = useBugShareBoard();
    const [accessCode, setAccessCode] = React.useState('');
    const [nickname, setNickname] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [filter, setFilter] = React.useState<BugShareBoardFilter>('open');
    const [selectedBugId, setSelectedBugId] = React.useState<string | null>(null);
    const [selectedBugDetail, setSelectedBugDetail] = React.useState<BugReportDetail | null>(null);
    const [detailLoading, setDetailLoading] = React.useState(false);

    const counts = React.useMemo(() => getBugShareBoardCounts(board.bugs), [board.bugs]);
    const filteredBugs = React.useMemo(() => (
        filterBugShareBoardItems(board.bugs, { filter, query })
    ), [board.bugs, filter, query]);

    const loadInlineBug = React.useCallback(async (bug: BugReportSummary | BugReportDetail) => {
        setSelectedBugId(bug.id);
        if ('comments' in bug) {
            setSelectedBugDetail(bug);
            return;
        }
        setDetailLoading(true);
        try {
            setSelectedBugDetail(await board.getBug(bug.id));
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setDetailLoading(false);
        }
    }, [board.getBug]);

    React.useEffect(() => {
        if (!board.isLoggedIn || !isWide) return;
        if (filteredBugs.length === 0) {
            setSelectedBugId(null);
            setSelectedBugDetail(null);
            return;
        }
        if (!selectedBugId || !filteredBugs.some((bug) => bug.id === selectedBugId)) {
            void loadInlineBug(filteredBugs[0]);
        }
    }, [board.isLoggedIn, filteredBugs, isWide, loadInlineBug, selectedBugId]);

    const handleLogin = React.useCallback(async () => {
        const trimmedCode = accessCode.trim();
        const trimmedNickname = nickname.trim();
        if (!trimmedCode) {
            Modal.alert(t('common.error'), t('bug.accessCodeRequired'));
            return;
        }
        if (!trimmedNickname) {
            Modal.alert(t('common.error'), t('bug.nicknameRequired'));
            return;
        }
        await board.login(trimmedCode, trimmedNickname);
    }, [accessCode, board, nickname]);

    const showBugDetail = React.useCallback(async (bug: BugReportSummary | BugReportDetail) => {
        if (isWide) {
            await loadInlineBug(bug);
            return;
        }
        try {
            const detail = 'comments' in bug ? bug : await board.getBug(bug.id);
            Modal.show({
                component: BugReportDetailModal,
                props: {
                    bug: detail,
                    onBugUpdated: () => { void board.refresh(query.trim() || undefined); },
                    onAddComment: async (current: BugReportDetail, body: string, images: LocalImage[]) => (
                        await board.addCommentWithImages(current.id, body, images)
                    ),
                    onUploadImages: async (current: BugReportDetail, images: LocalImage[], commentId?: string) => (
                        await board.uploadImages(current.id, images, commentId)
                    ),
                    onChangeStatus: async (current: BugReportDetail, status: BugStatus, action?: 'return_to_pending') => (
                        await board.changeStatus(current.id, status, action)
                    ),
                },
            });
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        }
    }, [board, isWide, loadInlineBug, query]);

    const handleCreateBug = React.useCallback(() => {
        Modal.show({
            component: BugReportCreateModal,
            props: {
                onCreate: async (description: string, images: LocalImage[]) => {
                    const bug = await board.createBugWithImages(description, images);
                    setFilter('open');
                    setTimeout(() => { void showBugDetail(bug); }, 0);
                    return bug;
                },
            },
        });
    }, [board, showBugDetail]);

    const handleInlineBugUpdated = React.useCallback((bug: BugReportDetail) => {
        setSelectedBugDetail(bug);
        setSelectedBugId(bug.id);
    }, []);

    const refreshBoard = React.useCallback(() => {
        void board.refresh(query.trim() || undefined);
    }, [board, query]);

    if (!board.isLoggedIn) {
        return (
            <View style={styles.screen}>
                <View style={styles.loginCard}>
                    <Text style={styles.title}>{t('bug.boardTitle')}</Text>
                    <Text style={styles.subtitle}>{board.error || t('bug.publicBoardSubtitle')}</Text>
                    <TextInput
                        style={styles.input}
                        value={accessCode}
                        onChangeText={setAccessCode}
                        placeholder={t('bug.accessCodePlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <TextInput
                        style={styles.input}
                        value={nickname}
                        onChangeText={setNickname}
                        placeholder={t('bug.nicknamePlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Pressable style={styles.primaryButton} disabled={board.loading} onPress={handleLogin}>
                        {board.loading ? <ActivityIndicator color={theme.colors.button.primary.tint} /> : <Text style={styles.primaryButtonText}>{t('bug.enterBoard')}</Text>}
                    </Pressable>
                </View>
            </View>
        );
    }

    const header = (
        <BugBoardHeader
            nickname={board.nickname}
            currentFilter={filter}
            counts={counts}
            query={query}
            loading={board.loading}
            error={board.error}
            onQueryChange={setQuery}
            onClearQuery={() => setQuery('')}
            onFilterChange={setFilter}
            onCreateBug={handleCreateBug}
            onRefresh={refreshBoard}
            onLogout={() => board.logout()}
        />
    );

    if (isWide) {
        return (
            <View style={styles.screen}>
                <View style={styles.desktopShell}>
                    <View style={styles.desktopTopBar}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.title}>{t('bug.boardTitle')}</Text>
                            <Text style={styles.subtitle}>{board.nickname} · {t('bug.currentFilter')}: {getFilterLabel(filter)} · {filteredBugs.length} {t('bug.items')}</Text>
                        </View>
                        <Pressable style={styles.iconButton} onPress={refreshBoard}>
                            <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
                        </Pressable>
                        <Pressable style={styles.iconButton} onPress={() => board.logout()}>
                            <Ionicons name="log-out-outline" size={20} color={theme.colors.text} />
                        </Pressable>
                    </View>
                    <View style={styles.desktopColumns}>
                        <ScrollView style={styles.leftPanel} contentContainerStyle={styles.leftPanelContent} refreshControl={<RefreshControl refreshing={board.loading} onRefresh={refreshBoard} tintColor={theme.colors.textSecondary} />}>
                            {header}
                            {filteredBugs.length === 0 ? (
                                <BugBoardEmpty query={query} loading={board.loading} />
                            ) : filteredBugs.map((bug) => (
                                <PublicBugListItem
                                    key={bug.id}
                                    bug={bug}
                                    selected={bug.id === selectedBugId}
                                    onPress={showBugDetail}
                                />
                            ))}
                        </ScrollView>
                        <View style={styles.detailPanel}>
                            <PublicBugDetailPane
                                bug={selectedBugDetail}
                                loading={detailLoading}
                                onBugUpdated={handleInlineBugUpdated}
                                onAddComment={async (current, body, images) => board.addCommentWithImages(current.id, body, images)}
                                onUploadImages={async (current, images, commentId) => board.uploadImages(current.id, images, commentId)}
                                onChangeStatus={async (current, status, action) => board.changeStatus(current.id, status, action)}
                            />
                        </View>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <FlatList
                data={filteredBugs}
                keyExtractor={(item) => `bug-${item.id}`}
                renderItem={({ item }) => <PublicBugListItem bug={item} selected={false} onPress={showBugDetail} />}
                refreshControl={<RefreshControl refreshing={board.loading} onRefresh={refreshBoard} tintColor={theme.colors.textSecondary} />}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={header}
                ListEmptyComponent={<BugBoardEmpty query={query} loading={board.loading} />}
            />
        </View>
    );
}

function BugBoardHeader({
    nickname,
    currentFilter,
    counts,
    query,
    loading,
    error,
    onQueryChange,
    onClearQuery,
    onFilterChange,
    onCreateBug,
    onRefresh,
    onLogout,
}: {
    nickname: string;
    currentFilter: BugShareBoardFilter;
    counts: Record<BugShareBoardFilter, number>;
    query: string;
    loading: boolean;
    error: string | null;
    onQueryChange: (value: string) => void;
    onClearQuery: () => void;
    onFilterChange: (value: BugShareBoardFilter) => void;
    onCreateBug: () => void;
    onRefresh: () => void;
    onLogout: () => void;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const filters: BugShareBoardFilter[] = ['all', 'open', 'pending', 'in_progress', 'verify', 'closed', 'has_comments', 'has_attachments'];

    return (
        <View style={styles.header}>
            <View style={styles.mobileTitleRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.headerMobileTitle}>{t('bug.boardTitle')}</Text>
                    <Text style={styles.subtitle}>{nickname} · {t('bug.currentFilter')}: {getFilterLabel(currentFilter)} · {counts[currentFilter]}</Text>
                </View>
                <Pressable style={styles.iconButton} onPress={onRefresh} disabled={loading}>
                    <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
                </Pressable>
                <Pressable style={styles.iconButton} onPress={onLogout}>
                    <Ionicons name="log-out-outline" size={20} color={theme.colors.text} />
                </Pressable>
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.statGrid}>
                <StatusStat label={t('bug.statusPending')} count={counts.pending} color={STATUS_ACCENTS.pending} />
                <StatusStat label={t('bug.statusInProgress')} count={counts.in_progress} color={STATUS_ACCENTS.in_progress} />
                <StatusStat label={t('bug.statusVerify')} count={counts.verify} color={STATUS_ACCENTS.verify} />
                <StatusStat label={t('bug.statusClosed')} count={counts.closed} color={STATUS_ACCENTS.closed} />
            </View>

            <View style={styles.filterWrap}>
                {filters.map((item) => (
                    <Pressable
                        key={item}
                        style={[styles.filterChip, currentFilter === item && styles.filterChipActive]}
                        onPress={() => onFilterChange(item)}
                    >
                        <View style={[styles.filterDot, { backgroundColor: getFilterAccent(item) }]} />
                        <Text style={[styles.filterChipText, currentFilter === item && styles.filterChipTextActive]}>{getFilterLabel(item)} {counts[item]}</Text>
                    </Pressable>
                ))}
            </View>

            <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
                <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={onQueryChange}
                    placeholder={t('bug.searchBugPlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCorrect={false}
                    autoCapitalize="none"
                />
                {query.trim().length > 0 && (
                    <Pressable onPress={onClearQuery} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>

            <Pressable style={styles.primaryButton} onPress={onCreateBug}>
                <Text style={styles.primaryButtonText}>+ {t('bug.newBug')}</Text>
            </Pressable>
            <Text style={styles.filterNote}>{t('bug.filterNote')}</Text>
        </View>
    );
}

function StatusStat({ label, count, color }: { label: string; count: number; color: string }) {
    const styles = stylesheet;
    return (
        <View style={styles.statCard}>
            <Text style={styles.statNumber}>{count}</Text>
            <Text style={styles.statLabel}>{label}</Text>
            <View style={[styles.statBar, { backgroundColor: color }]} />
        </View>
    );
}

function PublicBugListItem({ bug, selected, onPress }: {
    bug: BugReportSummary;
    selected: boolean;
    onPress: (bug: BugReportSummary) => void | Promise<void>;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <Pressable
            style={({ pressed }) => [styles.bugItem, selected && styles.bugItemSelected, pressed && { opacity: 0.78 }]}
            onPress={() => { void onPress(bug); }}
        >
            <View style={styles.bugIconCircle}><Text style={styles.bugIconText}>🐞</Text></View>
            <View style={styles.bugItemContent}>
                <Text style={styles.bugKicker} numberOfLines={1}>{bug.displayId} · {t('bug.recentActivity')}</Text>
                <Text style={styles.bugItemTitle} numberOfLines={2}>{bug.title}</Text>
                <View style={styles.bugMetaRow}>
                    <StatusPill status={bug.status} />
                    <Text style={styles.bugMetaText}>{bug.attachmentCount} {t('bug.screenshots')} · {bug.commentCount} {t('bug.comment')}</Text>
                </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

function StatusPill({ status }: { status: BugStatus }) {
    const styles = stylesheet;
    return (
        <View style={[styles.statusPill, { backgroundColor: getStatusSoftColor(status) }]}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_ACCENTS[status] }]} />
            <Text style={[styles.statusPillText, { color: getStatusTextColor(status) }]}>{bugStatusLabel(status)}</Text>
        </View>
    );
}

function getStatusSoftColor(status: BugStatus): string {
    switch (status) {
        case 'pending': return '#FFF2C7';
        case 'in_progress': return '#DBEAFE';
        case 'verify': return '#F3E8FF';
        case 'closed': return '#DCFCE7';
    }
}

function getStatusTextColor(status: BugStatus): string {
    switch (status) {
        case 'pending': return '#854D0E';
        case 'in_progress': return '#1D4ED8';
        case 'verify': return '#7E22CE';
        case 'closed': return '#15803D';
    }
}

function BugBoardEmpty({ query, loading }: { query: string; loading: boolean }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <View style={styles.empty}>
            <Ionicons name="bug-outline" size={46} color={theme.colors.textSecondary} style={{ opacity: 0.5 }} />
            <Text style={styles.emptyText}>{loading ? t('bug.loadingBugs') : (query.trim() ? t('bug.noMatchingBugs') : t('bug.noBugs'))}</Text>
        </View>
    );
}

function PublicBugDetailPane({
    bug,
    loading,
    onBugUpdated,
    onAddComment,
    onUploadImages,
    onChangeStatus,
}: {
    bug: BugReportDetail | null;
    loading: boolean;
    onBugUpdated: (bug: BugReportDetail) => void;
    onAddComment: (bug: BugReportDetail, body: string, images: LocalImage[]) => Promise<BugReportDetail>;
    onUploadImages: (bug: BugReportDetail, images: LocalImage[], commentId?: string) => Promise<BugReportDetail>;
    onChangeStatus: (bug: BugReportDetail, status: BugStatus, action?: 'return_to_pending') => Promise<BugReportDetail>;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [comment, setComment] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const picker = useImagePicker({ maxImages: BUG_IMAGE_LIMITS.maxImages, maxSizeBytes: BUG_IMAGE_LIMITS.maxSizeBytes });
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        setComment('');
        picker.clearImages();
    }, [bug?.id]);

    const run = React.useCallback(async (fn: () => Promise<BugReportDetail>) => {
        setBusy(true);
        try {
            const updated = await fn();
            onBugUpdated(updated);
            setComment('');
            picker.clearImages();
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [onBugUpdated, picker]);

    const handleComment = React.useCallback(() => {
        if (!bug) return;
        const body = comment.trim();
        if (!body) return;
        void run(() => onAddComment(bug, body, picker.images));
    }, [bug, comment, onAddComment, picker.images, run]);

    const handleUploadOnly = React.useCallback(() => {
        if (!bug || picker.images.length === 0) return;
        void run(() => onUploadImages(bug, picker.images));
    }, [bug, onUploadImages, picker.images, run]);

    const handleStatus = React.useCallback((status: BugStatus, action?: 'return_to_pending') => {
        if (!bug) return;
        void run(() => onChangeStatus(bug, status, action));
    }, [bug, onChangeStatus, run]);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;
        const remaining = Math.max(0, BUG_IMAGE_LIMITS.maxImages - picker.images.length);
        Array.from(files).slice(0, remaining).forEach(file => {
            if (file.size > BUG_IMAGE_LIMITS.maxSizeBytes) {
                Modal.alert(t('common.error'), t('bug.imageTooLarge'));
                return;
            }
            const url = URL.createObjectURL(file);
            void picker.addImageFromUri(url, file.type || 'image/jpeg');
        });
        event.target.value = '';
    }, [picker]);

    if (loading) {
        return <View style={styles.detailPlaceholder}><ActivityIndicator color={theme.colors.textSecondary} /><Text style={styles.emptyText}>{t('bug.loadingBugs')}</Text></View>;
    }

    if (!bug) {
        return (
            <View style={styles.detailPlaceholder}>
                <Ionicons name="bug-outline" size={52} color={theme.colors.textSecondary} style={{ opacity: 0.5 }} />
                <Text style={styles.detailPlaceholderTitle}>{t('bug.detailPlaceholderTitle')}</Text>
                <Text style={styles.emptyText}>{t('bug.detailPlaceholderSubtitle')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.detailContent}>
            <View style={styles.detailHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.detailKicker}>{bug.displayId} · <Text style={{ color: STATUS_ACCENTS[bug.status] }}>{bugStatusLabel(bug.status)}</Text></Text>
                    <Text style={styles.detailTitle} numberOfLines={2}>{bug.title}</Text>
                    <Text style={styles.subtitle}>{bug.createdByNickname ?? t('bug.anonymousUser')} · {t('bug.selectedInFilter')}</Text>
                </View>
            </View>

            <View style={styles.detailBody}>
                <ScrollView style={styles.detailMain} contentContainerStyle={styles.detailMainContent}>
                    <Text style={styles.sectionTitle}>{t('bug.description')}</Text>
                    <View style={styles.descriptionBox}>
                        <BugRichContentView description={bug.description} attachments={bug.attachments} />
                    </View>

                    <Text style={styles.sectionTitle}>{t('bug.comment')}</Text>
                    {bug.comments.length === 0 && <Text style={styles.muted}>-</Text>}
                    {bug.comments.map(item => (
                        <View key={item.id} style={styles.commentCard}>
                            <Text style={styles.commentAuthor}>{item.authorNickname ?? t('bug.anonymousUser')}</Text>
                            <Text style={styles.commentBody}>{item.body}</Text>
                            {item.attachments.length > 0 && (
                                <View style={styles.attachmentGrid}>{item.attachments.map(attachment => <Image key={attachment.id} source={{ uri: attachment.url }} style={styles.commentImage} contentFit="cover" />)}</View>
                            )}
                        </View>
                    ))}

                    <TextInput
                        style={styles.commentInput}
                        value={comment}
                        onChangeText={setComment}
                        placeholder={t('bug.addComment')}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                    />
                    <ImagePreview images={picker.images} onRemove={picker.removeImage} maxImages={BUG_IMAGE_LIMITS.maxImages} />
                    <View style={styles.inlineActionRow}>
                        <Pressable style={styles.secondaryButton} onPress={() => Platform.OS === 'web' ? fileInputRef.current?.click() : picker.pickFromGallery()}>
                            <Text style={styles.secondaryButtonText}>{t('bug.uploadScreenshots')}</Text>
                        </Pressable>
                        {picker.images.length > 0 && <Pressable style={styles.secondaryButton} onPress={handleUploadOnly}><Text style={styles.secondaryButtonText}>{t('bug.uploadOnly')}</Text></Pressable>}
                        <Pressable style={[styles.smallPrimaryButton, (!comment.trim() || busy) && { opacity: 0.55 }]} disabled={!comment.trim() || busy} onPress={handleComment}>
                            <Text style={styles.primaryButtonText}>{t('bug.addComment')}</Text>
                        </Pressable>
                    </View>
                    {Platform.OS === 'web' && <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />}
                </ScrollView>

                <View style={styles.detailSide}>
                    <Text style={styles.sectionTitle}>{t('bug.statusFlow')}</Text>
                    {bug.status !== 'pending' && (
                        <Pressable style={styles.statusActionRow} disabled={busy} onPress={() => handleStatus('pending', 'return_to_pending')}>
                            <View style={[styles.statusDot, { backgroundColor: STATUS_ACCENTS.pending }]} />
                            <Text style={styles.statusActionText}>{t('bug.returnToPending')}</Text>
                        </Pressable>
                    )}
                    {STATUS_OPTIONS.map(status => (
                        <Pressable
                            key={status}
                            style={[styles.statusActionRow, bug.status === status && styles.statusActionRowCurrent]}
                            disabled={busy || bug.status === status}
                            onPress={() => handleStatus(status)}
                        >
                            <View style={[styles.statusDot, { backgroundColor: STATUS_ACCENTS[status] }]} />
                            <Text style={styles.statusActionText}>{bugStatusLabel(status)}</Text>
                            <Text style={styles.statusActionMeta}>{bug.status === status ? t('bug.currentStatus') : t('bug.changeToThisStatus')}</Text>
                        </Pressable>
                    ))}

                    <Text style={styles.sectionTitle}>{t('bug.statusHistory')}</Text>
                    <View style={styles.historyList}>
                        {bug.statusHistory.map(entry => (
                            <View key={entry.id} style={styles.historyEvent}>
                                <View style={[styles.historyDot, { backgroundColor: STATUS_ACCENTS[entry.toStatus] }]} />
                                <View style={styles.historyCard}>
                                    <Text style={styles.historyText}>{formatBugStatusHistoryAction(entry)}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
            </View>
            {busy && <View style={styles.busyOverlay}><ActivityIndicator /></View>}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        alignItems: 'center',
    },
    loginCard: {
        width: '100%',
        maxWidth: 420,
        marginTop: 88,
        padding: 20,
        borderRadius: 24,
        backgroundColor: theme.colors.surface,
        gap: 12,
    },
    desktopShell: {
        width: '100%',
        maxWidth: 1160,
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 36,
        paddingBottom: 28,
    },
    desktopTopBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 18,
    },
    desktopColumns: {
        flex: 1,
        flexDirection: 'row',
        gap: 16,
        minHeight: 0,
    },
    leftPanel: {
        width: 440,
        flexShrink: 0,
        backgroundColor: theme.colors.surface,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    leftPanelContent: {
        paddingVertical: 16,
    },
    detailPanel: {
        flex: 1,
        minWidth: 0,
        backgroundColor: theme.colors.surface,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    listContent: {
        width: '100%',
        maxWidth: 760,
        paddingBottom: 80,
        paddingTop: 18,
    },
    header: {
        marginHorizontal: 16,
        marginBottom: 12,
        gap: 12,
    },
    mobileTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 30,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    headerMobileTitle: {
        fontSize: 24,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        marginTop: 6,
        color: theme.colors.textSecondary,
        lineHeight: 20,
        ...Typography.default(),
    },
    error: {
        color: theme.colors.status.error,
        ...Typography.default(),
    },
    input: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: theme.colors.text,
        backgroundColor: theme.colors.input.background,
        ...Typography.default(),
    },
    statGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    statCard: {
        flexGrow: 1,
        flexBasis: 96,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        padding: 12,
    },
    statNumber: {
        color: theme.colors.text,
        fontSize: 23,
        ...Typography.default('semiBold'),
    },
    statLabel: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
        ...Typography.default(),
    },
    statBar: {
        height: 4,
        borderRadius: 99,
        marginTop: 10,
    },
    filterWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    filterChipActive: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    filterDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    filterChipText: {
        color: theme.colors.text,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    filterChipTextActive: {
        color: theme.colors.button.primary.tint,
    },
    searchBox: {
        minHeight: 52,
        borderRadius: 16,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        color: theme.colors.text,
        ...Typography.default(),
    },
    filterNote: {
        color: '#8A5200',
        backgroundColor: '#FFF8DB',
        borderColor: '#F3DF9A',
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        lineHeight: 19,
        overflow: 'hidden',
        ...Typography.default('semiBold'),
    },
    primaryButton: {
        minHeight: 50,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    primaryButtonText: {
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    bugItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginHorizontal: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    bugItemSelected: {
        borderWidth: 2,
        borderColor: theme.colors.text,
    },
    bugIconCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF7ED',
    },
    bugIconText: { fontSize: 18 },
    bugItemContent: { flex: 1, minWidth: 0 },
    bugKicker: { fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() },
    bugItemTitle: { fontSize: 17, color: theme.colors.text, marginTop: 4, ...Typography.default('semiBold') },
    bugMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 7 },
    bugMetaText: { fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusPillText: { fontSize: 12, ...Typography.default('semiBold') },
    empty: {
        alignItems: 'center',
        paddingTop: 80,
        paddingHorizontal: 48,
        gap: 12,
    },
    emptyText: {
        color: theme.colors.textSecondary,
        textAlign: 'center',
        fontSize: 16,
        ...Typography.default(),
    },
    detailPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        gap: 12,
    },
    detailPlaceholderTitle: {
        color: theme.colors.text,
        fontSize: 20,
        ...Typography.default('semiBold'),
    },
    detailContent: {
        flex: 1,
        minHeight: 0,
    },
    detailHeader: {
        minHeight: 150,
        paddingHorizontal: 30,
        paddingVertical: 26,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    detailKicker: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    detailTitle: {
        color: theme.colors.text,
        fontSize: 31,
        lineHeight: 38,
        marginTop: 12,
        ...Typography.default('semiBold'),
    },
    detailBody: {
        flex: 1,
        minHeight: 0,
        flexDirection: 'row',
    },
    detailMain: {
        flex: 1,
        minWidth: 0,
    },
    detailMainContent: {
        padding: 28,
        paddingBottom: 48,
    },
    detailSide: {
        width: 280,
        borderLeftWidth: 1,
        borderLeftColor: theme.colors.divider,
        padding: 22,
        backgroundColor: theme.colors.surfaceHigh,
    },
    sectionTitle: {
        color: theme.colors.text,
        fontSize: 16,
        marginBottom: 10,
        marginTop: 8,
        ...Typography.default('semiBold'),
    },
    descriptionBox: {
        color: theme.colors.text,
        lineHeight: 24,
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 20,
        padding: 18,
        marginBottom: 18,
        ...Typography.default(),
    },
    muted: {
        color: theme.colors.textSecondary,
        marginBottom: 18,
        ...Typography.default(),
    },
    attachmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
    attachmentImage: { width: 118, height: 88, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh },
    commentImage: { width: 74, height: 58, borderRadius: 9, backgroundColor: theme.colors.surfaceHigh, marginTop: 8 },
    commentCard: { backgroundColor: theme.colors.surfaceHigh, borderRadius: 16, padding: 14, marginBottom: 10 },
    commentAuthor: { color: theme.colors.textSecondary, fontSize: 12, ...Typography.default('semiBold') },
    commentBody: { color: theme.colors.text, marginTop: 6, lineHeight: 20, ...Typography.default() },
    commentInput: { minHeight: 76, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 14, padding: 12, color: theme.colors.text, backgroundColor: theme.colors.input.background, ...Typography.default() },
    inlineActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 18 },
    secondaryButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.surfaceHigh },
    secondaryButtonText: { color: theme.colors.text, ...Typography.default('semiBold') },
    smallPrimaryButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.button.primary.background },
    statusActionRow: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        marginBottom: 9,
    },
    statusActionRowCurrent: {
        borderWidth: 2,
        borderColor: theme.colors.text,
    },
    statusActionText: { color: theme.colors.text, flex: 1, ...Typography.default('semiBold') },
    statusActionMeta: { color: theme.colors.textSecondary, fontSize: 12, ...Typography.default('semiBold') },
    historyList: {
        gap: 10,
    },
    historyEvent: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    historyDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
        marginTop: 12,
    },
    historyCard: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    historyText: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default('semiBold'),
    },
    busyOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.36)',
    },
}));
