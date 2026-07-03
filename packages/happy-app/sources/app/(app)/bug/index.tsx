import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { BugReportCreateModal } from '@/components/BugReportCreateModal';
import { BugReportDetailModal } from '@/components/BugReportDetailModal';
import { BugReportItem } from '@/components/BugReportItem';
import type { LocalImage } from '@/components/ImagePreview';
import { Typography } from '@/constants/Typography';
import { useBugShareBoard } from '@/hooks/useBugShareBoard';
import { Modal } from '@/modal';
import type { BugReportDetail, BugReportSummary, BugStatus } from '@/sync/bugTypes';
import { matchesBugSearch } from '@/sync/bugTypes';
import { t } from '@/text';

export default function PublicBugBoardPage() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const board = useBugShareBoard();
    const [accessCode, setAccessCode] = React.useState('');
    const [nickname, setNickname] = React.useState('');
    const [query, setQuery] = React.useState('');

    const filteredBugs = React.useMemo(() => (
        board.bugs.filter((bug) => matchesBugSearch(bug, query))
    ), [board.bugs, query]);

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
    }, [board, query]);

    const handleCreateBug = React.useCallback(() => {
        Modal.show({
            component: BugReportCreateModal,
            props: {
                onCreate: async (description: string, images: LocalImage[]) => {
                    const bug = await board.createBugWithImages(description, images);
                    setTimeout(() => { void showBugDetail(bug); }, 0);
                    return bug;
                },
            },
        });
    }, [board, showBugDetail]);

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

    return (
        <View style={styles.screen}>
            <FlatList
                data={filteredBugs}
                keyExtractor={(item) => `bug-${item.id}`}
                renderItem={({ item }) => <BugReportItem bug={item} onPress={showBugDetail} />}
                refreshControl={<RefreshControl refreshing={board.loading} onRefresh={() => { void board.refresh(query.trim() || undefined); }} tintColor={theme.colors.textSecondary} />}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={(
                    <View style={styles.header}>
                        <View style={styles.headerTitleRow}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={styles.title}>{t('bug.boardTitle')}</Text>
                                <Text style={styles.subtitle}>{board.nickname} · {t('bug.statusPending')} {board.pendingCount}</Text>
                            </View>
                            <Pressable style={styles.iconButton} onPress={() => { void board.refresh(query.trim() || undefined); }}>
                                <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
                            </Pressable>
                            <Pressable style={styles.iconButton} onPress={() => board.logout()}>
                                <Ionicons name="log-out-outline" size={20} color={theme.colors.text} />
                            </Pressable>
                        </View>
                        {!!board.error && <Text style={styles.error}>{board.error}</Text>}
                        <View style={styles.searchBox}>
                            <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
                            <TextInput
                                style={styles.searchInput}
                                value={query}
                                onChangeText={setQuery}
                                placeholder={t('bug.searchBugPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCorrect={false}
                                autoCapitalize="none"
                            />
                            {query.trim().length > 0 && (
                                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                            )}
                        </View>
                        <Pressable style={styles.primaryButton} onPress={handleCreateBug}>
                            <Text style={styles.primaryButtonText}>{t('bug.newBug')}</Text>
                        </Pressable>
                    </View>
                )}
                ListEmptyComponent={(
                    <View style={styles.empty}>
                        <Ionicons name="bug-outline" size={46} color={theme.colors.textSecondary} style={{ opacity: 0.5 }} />
                        <Text style={styles.emptyText}>{board.loading ? t('bug.loadingBugs') : (query.trim() ? t('bug.noMatchingBugs') : t('bug.noBugs'))}</Text>
                    </View>
                )}
            />
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
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
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
    searchBox: {
        minHeight: 42,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        color: theme.colors.text,
        ...Typography.default(),
    },
    primaryButton: {
        minHeight: 44,
        borderRadius: 14,
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
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
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
}));
