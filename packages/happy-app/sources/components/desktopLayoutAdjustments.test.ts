import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('desktop layout adjustments', () => {
    it('renders the public share owner metadata in the same header row as the title', () => {
        const source = read('app/(app)/share/[token].tsx');
        expect(source).toContain('ShareHeader');
        expect(source).toContain('styles.shareHeader');
        expect(source).toContain('styles.shareOwnerInline');
        expect(source).toContain("flexWrap: 'nowrap'");
        expect(source).not.toContain('{owner && <OwnerCard owner={owner} />}');

        const layout = read('app/(app)/_layout.tsx');
        expect(layout).toMatch(/name="share\/\[token\]"[\s\S]*?headerShown: false/);
    });

    it('uses a contained desktop dialog for MCP server management instead of a full-page modal', () => {
        const source = read('components/McpServersModal.tsx');
        expect(source).toContain('transparent={true}');
        expect(source).toContain('styles.backdrop');
        expect(source).toContain('styles.dialog');
        expect(source).toContain("height: '72%'");
        expect(source).not.toContain('transparent={false}');
    });

    it('gives large web prompts more desktop width and height', () => {
        const source = read('modal/components/WebPromptModal.tsx');
        expect(source).toContain('LARGE_PROMPT_MAX_WIDTH = 720');
        expect(source).toContain('LARGE_PROMPT_HEIGHT_RATIO = 0.9');
        expect(source).toContain('visibleMultilineRows = config.multiline ? Math.min(config.multilineRows ?? 6, isLargePrompt ? 16 : 8) : 1');
    });

    it('uses the Codex-home Claude .mcp.json target so shared MCP config is visible', () => {
        const source = read('app/(app)/settings/mcpTargets.ts');
        expect(source).toContain("fileName: '.codex/.mcp.json'");
        expect(source).toContain("subtitle: '~/.codex/.mcp.json · mcpServers'");
        expect(source).toContain('codecTarget');
    });

    it('loads older public-share messages when the shared conversation is scrolled upward', () => {
        const page = read('app/(app)/share/[token].tsx');
        expect(page).toContain('hasMore, isLoadingMore, loadMore');
        expect(page).toContain('ListFooterComponent={listFooter}');
        expect(page).toContain('onEndReached={loadMore}');
        expect(page).toContain('maintainVisibleContentPosition');

        const hook = read('hooks/usePublicShareSession.ts');
        expect(hook).toContain('oldestSeqRef');
        expect(hook).toContain('before: oldestSeqRef.current');
        expect(hook).toContain('setMessages((current) =>');

        const api = read('sync/apiSharing.ts');
        expect(api).toContain("url.searchParams.set('before', String(options.before))");
        expect(api).toContain('hasMore: data.hasMore ?? false');
    });


    it('does not show a false failure alert when pending send-now abort is already unavailable', () => {
        const source = read('-session/SessionView.tsx');
        expect(source).toContain('const success = await sync.pinPendingMessage(sessionId, pendingId);');
        expect(source).toContain('await sessionAbort(sessionId);');
        expect(source).toContain("don't show a false failure");
        expect(source).not.toContain(`await sync.pinPendingMessage(sessionId, pendingId);
            await sessionAbort(sessionId);
        } catch {
            Modal.alert`);
    });


    it('batch-sends multiple pending messages instead of sending them one by one', () => {
        const source = read('-session/SessionView.tsx');
        expect(source).toContain('if (pendingMessages.length > 1)');
        expect(source).toContain('buildPendingQueueBatchPrompt(pendingMessages, pendingId)');
        expect(source).toContain('sync.sendOrQueueMessage(sessionId, batchPrompt)');
        expect(source).toContain('pendingMessages.map((message) => sync.deletePendingMessage(sessionId, message.id))');
    });


    it('opens the session terminal as a bottom resizable panel instead of a floating modal', () => {
        const sessionView = read('-session/SessionView.tsx');
        expect(sessionView).toContain("import { TerminalPanel } from '@/components/Terminal';");
        expect(sessionView).toContain('onPress={() => setShowTerminal(prev => !prev)}');
        expect(sessionView).toContain('<TerminalPanel');
        expect(sessionView).toContain('paddingBottom: showTerminal ? 0 : safeArea.bottom');
        expect(sessionView).not.toContain(`<Terminal\n                visible={showTerminal}`);

        const terminalWeb = read('components/Terminal.web.tsx');
        expect(terminalWeb).toContain('export const TerminalPanel');
        expect(terminalWeb).toContain("window.localStorage?.getItem('terminal.panelHeight')");
        expect(terminalWeb).toContain('height: panelHeight');
        expect(terminalWeb).toContain('handlePanelResizeStart');
        expect(terminalWeb).toContain("alignSelf: 'stretch'");
        expect(terminalWeb).toContain("width: '100%'");
        expect(terminalWeb).toContain("backgroundColor: '#ffffff'");
        expect(terminalWeb).toContain("background: '#f8fafc'");
        expect(terminalWeb).toContain('height: 28');
        expect(terminalWeb).toContain('terminalTabs');
        expect(terminalWeb).toContain('activeTerminalTabId');
        expect(terminalWeb).toContain('active={tab.id === activeTerminalTabId}');
        expect(terminalWeb).toContain('React.useLayoutEffect(() => {');
        expect(terminalWeb).toContain('fitAndResize');
        expect(terminalWeb).toContain('opacity: isActivating ? 0 : 1');
        expect(terminalWeb).toContain('handleAddTerminalTab');
        expect(terminalWeb).toContain('handleCloseTerminalTab');
        expect(terminalWeb).toContain('aria-label="New terminal tab"');
        expect(terminalWeb).toContain('aria-label="Close terminal tab"');
        expect(terminalWeb).toContain('terminalLabelFromCwd');
        expect(terminalWeb).not.toContain('height: 36,\n                    flexDirection');
    });


    it('uses a dark empty editor area in the file viewer modal', () => {
        const source = read('components/FileViewerModal.web.tsx');
        expect(source).toContain("<View style={{ flex: 1, minWidth: 0, backgroundColor: '#1e1e1e' }}>");
        expect(source).toContain("<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e1e1e' }}>");
        expect(source).toContain("color: '#8f8f8f'");
    });

    it('falls back to machine read only for absolute image previews outside the session working directory', () => {
        const source = read('components/FileViewerModal.web.tsx');
        expect(source).toContain('const machineReadFallbackId = machineId ?? session?.metadata?.machineId;');
        expect(source).toContain('isPreviewableImage(p)');
        expect(source).toContain('isAbsoluteLocalPath(p)');
        expect(source).toContain('isOutsideWorkingDirectoryError(response.error)');
        expect(source).toContain('return machineReadFile(machineReadFallbackId, p);');
    });

    it('manages enter-to-send separately for web/desktop and mobile', () => {
        const features = read('app/(app)/settings/features.tsx');
        expect(features).toContain("useSettingMutable('agentInputEnterToSendWeb')");
        expect(features).toContain("useSettingMutable('agentInputEnterToSendMobile')");
        expect(features).toContain("t('settingsFeatures.enterToSendWeb')");
        expect(features).toContain("t('settingsFeatures.enterToSendMobile')");

        const input = read('components/AgentInput.tsx');
        expect(input).toContain("Platform.OS === 'web' ? agentInputEnterToSendWeb : agentInputEnterToSendMobile");

        const settings = read('sync/settings.ts');
        expect(settings).toContain('agentInputEnterToSendWeb: z.boolean()');
        expect(settings).toContain('agentInputEnterToSendMobile: z.boolean()');
        expect(settings).toContain('parsed.data.agentInputEnterToSendWeb ??= parsed.data.agentInputEnterToSend');
        expect(settings).toContain('parsed.data.agentInputEnterToSendMobile ??= parsed.data.agentInputEnterToSend');
    });

    it('does not create a wide blank strip between the permanent sidebar and main content', () => {
        const source = read('components/SidebarNavigator.tsx');
        expect(source).toContain('borderRightWidth: 1');
        expect(source).not.toContain('borderRightWidth: 16');
    });


    it('offers a session-scoped allow all tools action in permission prompts', () => {
        const source = read('components/tools/PermissionFooter.tsx');
        expect(source).toContain('handleCodexApproveAllTools');
        expect(source).toContain("updateSessionPermissionMode(sessionId, 'yolo')");
        expect(source).toContain('handleApproveAllTools');
        expect(source).toContain("sessionAllow(sessionId, permission.id, 'bypassPermissions')");
        expect(source).toContain("t('codex.permissions.yesAllowAllTools')");
        expect(source).toContain("t('claude.permissions.yesAllowAllTools')");

        const zhHans = read('text/translations/zh-Hans.ts');
        expect(zhHans).toContain('是，允许本次会话的所有工具');
    });


    it('shows cached GitHub issue inbox results while refreshing in the background', () => {
        const source = read('components/SessionsList.tsx');
        expect(source).toContain('buildGitHubIssueInboxCacheKey');
        expect(source).toContain("useLocalSettingMutable('githubIssueInboxCache')");
        expect(source).toContain('setPendingIssues(cached.issues)');
        expect(source).toContain('void loadPendingIssues(!cached)');
        expect(source).toContain('withGitHubIssueInboxCacheEntry');

        const localSettings = read('sync/localSettings.ts');
        expect(localSettings).toContain('githubIssueInboxCache');
        expect(localSettings).toContain('Device-local cached GitHub issue inbox results keyed by filters');
    });


    it('linkifies local file paths inside markdown code blocks', () => {
        const markdown = read('components/markdown/MarkdownView.tsx');
        expect(markdown).toContain('resolveCodeBlockLocalFileReference');
        expect(markdown).toContain('resolveLocalFileReference={resolveCodeBlockLocalFileReference}');

        const highlighter = read('components/SimpleSyntaxHighlighter.tsx');
        expect(highlighter).toContain('localFileReference');
        expect(highlighter).toContain('resolveLocalFileReference');
        expect(highlighter).toContain('<Link');
    });

});
