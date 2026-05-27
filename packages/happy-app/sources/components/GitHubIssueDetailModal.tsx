import React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useAuth } from '@/auth/AuthContext';
import { listGitHubIssues, updateGitHubIssueProjectStatus, type GitHubIssue } from '@/sync/apiGithub';
import { buildGitHubIssueInlineMarkdownParts } from '@/components/githubIssueInlineMarkdownParts';

const COMMON_GITHUB_PROJECT_STATUSES = ['No Status', 'Triage', 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done'];

const styles = StyleSheet.create((theme) => ({
    issueDetailModal: {
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        overflow: 'hidden',
    },
    issueDetailHeader: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    issueDetailRepo: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueDetailTitle: {
        marginTop: 6,
        fontSize: 21,
        fontWeight: '700',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    issueDetailBody: {
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
    issueDetailLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
    },
    issueMarkdownParagraph: {
        fontSize: 15,
        lineHeight: 24,
        color: theme.colors.text,
        marginBottom: 10,
        ...Typography.default(),
    },
    issueMarkdownHeading: {
        fontSize: 18,
        lineHeight: 26,
        color: theme.colors.text,
        fontWeight: '700',
        marginTop: 14,
        marginBottom: 10,
        ...Typography.default('semiBold'),
    },
    issueMarkdownQuote: {
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.divider,
        paddingLeft: 10,
        marginVertical: 8,
    },
    issueMarkdownQuoteText: {
        fontSize: 15,
        lineHeight: 24,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueMarkdownListRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    issueMarkdownListMarker: {
        width: 24,
        fontSize: 15,
        lineHeight: 24,
        color: theme.colors.text,
        ...Typography.default(),
    },
    issueMarkdownListText: {
        flex: 1,
        fontSize: 15,
        lineHeight: 24,
        color: theme.colors.text,
        ...Typography.default(),
    },
    issueMarkdownInlineCode: {
        fontFamily: 'monospace',
        backgroundColor: theme.colors.groupped.background,
        color: theme.colors.text,
    },
    issueMarkdownItalic: {
        fontStyle: 'italic',
    },
    issueMarkdownLink: {
        color: theme.colors.button.primary.background,
        textDecorationLine: 'underline',
    },
    issueMarkdownCodeBlock: {
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginVertical: 10,
    },
    issueMarkdownCodeText: {
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.text,
    },
    issueMarkdownSpacer: {
        height: 8,
    },
    issueDetailActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        minHeight: 56,
    },
    issueDetailAction: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    issueDetailActionSeparator: {
        width: 1,
        backgroundColor: theme.colors.divider,
    },
    issueDetailActionText: {
        fontSize: 16,
        color: theme.colors.button.primary.background,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
}));

function getGitHubIssueInlineSpanStyle(spanStyles: Array<'italic' | 'bold' | 'semibold' | 'code'>) {
    return spanStyles.map((styleName) => {
        if (styleName === 'code') return styles.issueMarkdownInlineCode;
        if (styleName === 'italic') return styles.issueMarkdownItalic;
        if (styleName === 'bold' || styleName === 'semibold') return Typography.default('semiBold');
        return undefined;
    }).filter(Boolean);
}

function renderGitHubIssueInlineMarkdown(text: string, keyPrefix: string) {
    const parts = buildGitHubIssueInlineMarkdownParts(text);

    return parts.map((part, index) => {
        if (typeof part === 'string') {
            return part;
        }
        const spanStyle = getGitHubIssueInlineSpanStyle(part.styles);
        if (part.type === 'link') {
            return (
                <Text
                    key={`${keyPrefix}-${index}`}
                    style={[styles.issueMarkdownLink, ...spanStyle]}
                    onPress={() => { void Linking.openURL(part.url); }}
                >
                    {part.text}
                </Text>
            );
        }
        return (
            <Text key={`${keyPrefix}-${index}`} style={spanStyle}>
                {part.text}
            </Text>
        );
    });
}

const GitHubIssueMarkdown = React.memo(({ body }: { body: string }) => {
    const blocks = React.useMemo(() => {
        const lines = body.replace(/\r\n/g, '\n').split('\n');
        const result: Array<
            | { type: 'blank' }
            | { type: 'code'; language: string; text: string }
            | { type: 'heading'; text: string }
            | { type: 'quote'; text: string }
            | { type: 'list'; marker: string; text: string }
            | { type: 'paragraph'; text: string }
        > = [];

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            const fence = line.match(/^```(\w+)?\s*$/);
            if (fence) {
                const codeLines: string[] = [];
                index += 1;
                while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
                    codeLines.push(lines[index] ?? '');
                    index += 1;
                }
                result.push({ type: 'code', language: fence[1] ?? '', text: codeLines.join('\n') });
                continue;
            }
            if (!line.trim()) {
                result.push({ type: 'blank' });
                continue;
            }
            const heading = line.match(/^#{1,3}\s+(.+)$/);
            if (heading) {
                result.push({ type: 'heading', text: heading[1] ?? '' });
                continue;
            }
            const quote = line.match(/^>\s?(.*)$/);
            if (quote) {
                result.push({ type: 'quote', text: quote[1] ?? '' });
                continue;
            }
            const unordered = line.match(/^\s*[-*•]\s+(.+)$/);
            if (unordered) {
                result.push({ type: 'list', marker: '•', text: unordered[1] ?? '' });
                continue;
            }
            const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
            if (ordered) {
                result.push({ type: 'list', marker: `${ordered[1]}.`, text: ordered[2] ?? '' });
                continue;
            }
            result.push({ type: 'paragraph', text: line });
        }
        return result;
    }, [body]);

    return (
        <View>
            {blocks.map((block, index) => {
                if (block.type === 'blank') {
                    return <View key={`blank-${index}`} style={styles.issueMarkdownSpacer} />;
                }
                if (block.type === 'code') {
                    return (
                        <ScrollView key={`code-${index}`} horizontal style={styles.issueMarkdownCodeBlock}>
                            <Text style={styles.issueMarkdownCodeText} selectable>
                                {block.text}
                            </Text>
                        </ScrollView>
                    );
                }
                if (block.type === 'heading') {
                    return (
                        <Text key={`heading-${index}`} style={styles.issueMarkdownHeading} selectable>
                            {renderGitHubIssueInlineMarkdown(block.text, `heading-${index}`)}
                        </Text>
                    );
                }
                if (block.type === 'quote') {
                    return (
                        <View key={`quote-${index}`} style={styles.issueMarkdownQuote}>
                            <Text style={styles.issueMarkdownQuoteText} selectable>
                                {renderGitHubIssueInlineMarkdown(block.text, `quote-${index}`)}
                            </Text>
                        </View>
                    );
                }
                if (block.type === 'list') {
                    return (
                        <View key={`list-${index}`} style={styles.issueMarkdownListRow}>
                            <Text style={styles.issueMarkdownListMarker} selectable>
                                {block.marker}
                            </Text>
                            <Text style={styles.issueMarkdownListText} selectable>
                                {renderGitHubIssueInlineMarkdown(block.text, `list-${index}`)}
                            </Text>
                        </View>
                    );
                }
                return (
                    <Text key={`paragraph-${index}`} style={styles.issueMarkdownParagraph} selectable>
                        {renderGitHubIssueInlineMarkdown(block.text, `paragraph-${index}`)}
                    </Text>
                );
            })}
        </View>
    );
});

function buildIssueQuery(repository: string, number: number): string {
    return `repo:${repository} is:issue ${number}`;
}

export const GitHubIssueDetailModal = React.memo(({
    issue,
    onStart,
    onClose,
    onIssueUpdated,
    fetchLatest = false,
}: {
    issue: GitHubIssue;
    onStart?: () => void;
    onClose: () => void;
    onIssueUpdated?: (issue: GitHubIssue) => void;
    fetchLatest?: boolean;
}) => {
    const auth = useAuth();
    const windowSize = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const [currentIssue, setCurrentIssue] = React.useState(issue);
    const [statusMenuVisible, setStatusMenuVisible] = React.useState(false);
    const [updatingStatus, setUpdatingStatus] = React.useState(false);
    const [loadingLatest, setLoadingLatest] = React.useState(fetchLatest);
    const [loadWarning, setLoadWarning] = React.useState<string | null>(null);

    const issueModalLayout = React.useMemo(() => {
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

    React.useEffect(() => {
        if (!fetchLatest || !auth.credentials) {
            setLoadingLatest(false);
            return;
        }
        let cancelled = false;
        setLoadingLatest(true);
        setLoadWarning(null);
        listGitHubIssues(auth.credentials, {
            query: buildIssueQuery(issue.repository, issue.number),
            limit: 10,
        }).then((result) => {
            if (cancelled) return;
            const exactIssue = result.issues.find((item) => (
                item.repository === issue.repository && item.number === issue.number
            ));
            if (exactIssue) {
                setCurrentIssue(exactIssue);
                onIssueUpdated?.(exactIssue);
            } else if (result.warning) {
                setLoadWarning(result.warning);
            } else {
                setLoadWarning('未能读取 GitHub 最新内容，正在显示会话内保存的任务快照。');
            }
        }).catch((error) => {
            if (cancelled) return;
            setLoadWarning(error instanceof Error ? error.message : String(error));
        }).finally(() => {
            if (!cancelled) setLoadingLatest(false);
        });
        return () => { cancelled = true; };
    }, [auth.credentials, fetchLatest, issue.number, issue.repository, onIssueUpdated]);

    const updatedAt = React.useMemo(() => {
        const date = new Date(currentIssue.updatedAt);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    }, [currentIssue.updatedAt]);
    const body = currentIssue.body?.trim() || '这个 Issue 没有正文。';
    const statusText = currentIssue.projectStatuses.length > 0 ? currentIssue.projectStatuses.join(', ') : 'No Status';
    const projectText = currentIssue.projectTitles.length > 0 ? currentIssue.projectTitles.join(', ') : '未关联 Project';
    const targetProjectTitle = currentIssue.projectTitles[0];

    const handleSetStatus = React.useCallback(async (nextStatus: string) => {
        if (!auth.credentials || updatingStatus) return;
        setStatusMenuVisible(false);
        setUpdatingStatus(true);
        try {
            const result = await updateGitHubIssueProjectStatus(auth.credentials, {
                repository: currentIssue.repository,
                number: currentIssue.number,
                projectTitle: targetProjectTitle,
                status: nextStatus,
            });
            setCurrentIssue(result.issue);
            onIssueUpdated?.(result.issue);
        } catch (error) {
            Modal.alert('修改 GitHub 状态失败', error instanceof Error ? error.message : String(error));
        } finally {
            setUpdatingStatus(false);
        }
    }, [auth.credentials, currentIssue.number, currentIssue.repository, onIssueUpdated, targetProjectTitle, updatingStatus]);

    const statusMenuItems = React.useMemo<ActionMenuItem[]>(() => {
        const currentStatuses = new Set(currentIssue.projectStatuses.map((item) => item.toLowerCase()));
        return COMMON_GITHUB_PROJECT_STATUSES.map((status) => ({
            label: status,
            selected: currentStatuses.has(status.toLowerCase()),
            onPress: () => { void handleSetStatus(status); },
        }));
    }, [currentIssue.projectStatuses, handleSetStatus]);

    return (
        <View style={[styles.issueDetailModal, issueModalLayout.modal]}>
            <View style={styles.issueDetailHeader}>
                <Text style={styles.issueDetailRepo} selectable>
                    {currentIssue.repository} · #{currentIssue.number} · {projectText} · 状态 {statusText}
                </Text>
                <Text style={styles.issueDetailTitle} selectable>
                    {currentIssue.title}
                </Text>
                {!!updatedAt && (
                    <Text style={styles.issueDetailRepo} selectable>
                        更新于 {updatedAt}{currentIssue.labels.length ? ` · ${currentIssue.labels.join(', ')}` : ''}
                    </Text>
                )}
            </View>
            <ScrollView style={[styles.issueDetailBody, issueModalLayout.body]}>
                {loadingLatest && (
                    <View style={styles.issueDetailLoading}>
                        <ActivityIndicator size="small" />
                        <Text style={styles.issueDetailRepo}>正在读取 GitHub 最新内容…</Text>
                    </View>
                )}
                {!!loadWarning && (
                    <Text style={styles.issueMarkdownQuoteText}>
                        {loadWarning}
                    </Text>
                )}
                <GitHubIssueMarkdown body={body} />
            </ScrollView>
            <View style={styles.issueDetailActions}>
                <Pressable style={styles.issueDetailAction} onPress={onClose}>
                    <Text style={styles.issueDetailActionText}>关闭</Text>
                </Pressable>
                <View style={styles.issueDetailActionSeparator} />
                <Pressable style={styles.issueDetailAction} onPress={() => { void Linking.openURL(currentIssue.htmlUrl); }}>
                    <Text style={styles.issueDetailActionText}>打开 GitHub</Text>
                </Pressable>
                <View style={styles.issueDetailActionSeparator} />
                <Pressable
                    style={styles.issueDetailAction}
                    disabled={updatingStatus}
                    onPress={() => setStatusMenuVisible(true)}
                >
                    <Text style={styles.issueDetailActionText}>
                        {updatingStatus ? '修改中…' : '改状态'}
                    </Text>
                </Pressable>
                {!!onStart && (
                    <>
                        <View style={styles.issueDetailActionSeparator} />
                        <Pressable style={styles.issueDetailAction} onPress={() => { onClose(); onStart(); }}>
                            <Text style={styles.issueDetailActionText}>开始任务</Text>
                        </Pressable>
                    </>
                )}
            </View>
            <ActionMenuModal
                visible={statusMenuVisible}
                title={`修改 GitHub 状态：${statusText}`}
                items={statusMenuItems}
                onClose={() => setStatusMenuVisible(false)}
            />
        </View>
    );
});
